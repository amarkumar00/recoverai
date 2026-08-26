import { createHash } from "node:crypto";

import {
  adapterCallContextSchema,
  adapterPaymentLinkSchema,
  adapterPaymentSchema,
  cancelPaymentLinkRequestSchema,
  cancelPaymentLinkResultSchema,
  createPaymentLinkRequestSchema,
  createPaymentLinkResultSchema,
  fetchDowntimeRequestSchema,
  fetchDowntimeResultSchema,
  fetchPaymentLinkRequestSchema,
  fetchPaymentLinkResultSchema,
  fetchPaymentRequestSchema,
  fetchPaymentResultSchema,
  mockCallLogEntrySchema,
  mockFailureModeSchema,
  mockOperationSchema,
  type AdapterPayment,
  type AdapterPaymentLink,
  type CancelPaymentLinkRequest,
  type CancelPaymentLinkResult,
  type CreatePaymentLinkRequest,
  type CreatePaymentLinkResult,
  type FetchDowntimeRequest,
  type FetchDowntimeResult,
  type FetchPaymentLinkRequest,
  type FetchPaymentLinkResult,
  type FetchPaymentRequest,
  type FetchPaymentResult,
  type MockCallLogEntry,
  type MockFailureMode,
  type MockOperation,
} from "@/adapters/razorpay/contracts";
import { canonicalTimestampSchema } from "@/domain/primitives";
import { normalizedPaymentStatusSchema } from "@/domain/payments";
import type { RazorpayCapabilityPort } from "@/ports/razorpay";

type PortContext = Parameters<RazorpayCapabilityPort["fetchPayment"]>[1];
type DowntimeFixture = {
  method: string;
  bankOrProvider?: string;
  active: boolean;
};

const SAFE_EXPLANATIONS = {
  NOT_FOUND: "The requested mock resource was not found.",
  TIMEOUT:
    "The deterministic mock operation timed out; no automatic retry was attempted.",
  DEPENDENCY_UNAVAILABLE: "The deterministic mock dependency is unavailable.",
  INVALID_RESPONSE:
    "The deterministic mock returned an invalid-response outcome.",
  REFERENCE_CONFLICT:
    "The Payment Link reference already belongs to different trusted values.",
} as const;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function fixtureKey(method: string, bankOrProvider?: string) {
  return `${method}:${bankOrProvider ?? "all"}`;
}

function externalLinkId(referenceId: string) {
  return `mock_plink_${createHash("sha256").update(`recoverai_mock_v1:${referenceId}`).digest("hex").slice(0, 24)}`;
}

export class DeterministicMockRazorpayAdapter implements RazorpayCapabilityPort {
  readonly #payments = new Map<string, AdapterPayment>();
  readonly #downtime = new Map<string, DowntimeFixture>();
  readonly #linksByReference = new Map<string, AdapterPaymentLink>();
  readonly #linksByExternalId = new Map<string, AdapterPaymentLink>();
  readonly #failures = new Map<string, MockFailureMode[]>();
  readonly #callLog: MockCallLogEntry[] = [];

  constructor(
    fixtures: {
      payments?: unknown[];
      downtime?: DowntimeFixture[];
      paymentLinks?: unknown[];
    } = {},
  ) {
    for (const rawPayment of fixtures.payments ?? []) {
      const payment = adapterPaymentSchema.parse(rawPayment);
      this.#payments.set(payment.paymentId, clone(payment));
    }
    for (const fixture of fixtures.downtime ?? []) {
      const request = fetchDowntimeRequestSchema.parse({
        method: fixture.method,
        ...(fixture.bankOrProvider === undefined
          ? {}
          : { bankOrProvider: fixture.bankOrProvider }),
      });
      this.#downtime.set(fixtureKey(request.method, request.bankOrProvider), {
        method: request.method,
        ...(request.bankOrProvider === undefined
          ? {}
          : { bankOrProvider: request.bankOrProvider }),
        active: fixture.active,
      });
    }
    for (const rawLink of fixtures.paymentLinks ?? []) {
      const link = adapterPaymentLinkSchema.parse(rawLink);
      this.#linksByReference.set(link.referenceId, clone(link));
      this.#linksByExternalId.set(link.externalLinkId, clone(link));
    }
  }

  injectFailure(
    operation: MockOperation,
    resourceReference: string,
    mode: MockFailureMode,
    times = 1,
  ) {
    const validatedOperation = mockOperationSchema.parse(operation);
    const validatedMode = mockFailureModeSchema.parse(mode);
    if (!Number.isSafeInteger(times) || times < 1 || times > 100)
      throw new Error("Failure count must be between 1 and 100.");
    const key = `${validatedOperation}:${resourceReference}`;
    this.#failures.set(
      key,
      Array.from({ length: times }, () => validatedMode),
    );
  }

  setPaymentStatus(paymentId: string, status: AdapterPayment["status"]) {
    const existing = this.#payments.get(paymentId);
    if (existing === undefined) throw new Error("Unknown mock payment.");
    this.#payments.set(paymentId, {
      ...existing,
      status: normalizedPaymentStatusSchema.parse(status),
    });
  }

  setPaymentLinkStatus(
    externalLinkId: string,
    status: AdapterPaymentLink["status"],
    updatedAt: string,
  ) {
    const existing = this.#linksByExternalId.get(externalLinkId);
    if (existing === undefined) throw new Error("Unknown mock Payment Link.");
    const next = adapterPaymentLinkSchema.parse({
      ...existing,
      status,
      amountPaidSubunits:
        status === "PAID"
          ? existing.amountSubunits
          : status === "PARTIALLY_PAID"
            ? Math.max(1, Math.floor(existing.amountSubunits / 2))
            : (existing.amountPaidSubunits ?? 0),
      updatedAt: canonicalTimestampSchema.parse(updatedAt),
    });
    this.#storeLink(next);
  }

  getCallLog(): MockCallLogEntry[] {
    return clone(this.#callLog);
  }

  inspectPaymentLink(externalLinkId: string): AdapterPaymentLink | null {
    const link = this.#linksByExternalId.get(externalLinkId);
    return link === undefined ? null : clone(link);
  }

  async fetchPayment(
    rawRequest: FetchPaymentRequest,
    rawContext: PortContext,
  ): Promise<FetchPaymentResult> {
    const request = fetchPaymentRequestSchema.parse(rawRequest);
    const context = this.#context(rawContext);
    const failure = this.#consumeFailure("FETCH_PAYMENT", request.paymentId);
    if (failure !== undefined)
      return this.#paymentFailure(failure, request.paymentId);
    const payment = this.#payments.get(request.paymentId);
    if (payment === undefined) {
      this.#log("FETCH_PAYMENT", request.paymentId, "NOT_FOUND");
      return fetchPaymentResultSchema.parse({
        status: "NOT_FOUND",
        errorCode: "NOT_FOUND",
        explanation: SAFE_EXPLANATIONS.NOT_FOUND,
      });
    }
    const result = {
      status: "AVAILABLE" as const,
      payment: { ...clone(payment), fetchedAt: context.requestedAt },
    };
    this.#log("FETCH_PAYMENT", request.paymentId, "AVAILABLE");
    return fetchPaymentResultSchema.parse(result);
  }

  async fetchDowntime(
    rawRequest: FetchDowntimeRequest,
    rawContext: PortContext,
  ): Promise<FetchDowntimeResult> {
    const request = fetchDowntimeRequestSchema.parse(rawRequest);
    const context = this.#context(rawContext);
    const resource = fixtureKey(request.method, request.bankOrProvider);
    const failure = this.#consumeFailure("FETCH_DOWNTIME", resource);
    if (failure !== undefined) {
      const status =
        failure === "TIMEOUT"
          ? "TIMEOUT"
          : failure === "INVALID_RESPONSE"
            ? "INVALID_RESPONSE"
            : "DEPENDENCY_UNAVAILABLE";
      this.#log("FETCH_DOWNTIME", resource, status);
      return fetchDowntimeResultSchema.parse({
        status,
        errorCode: status,
        explanation: SAFE_EXPLANATIONS[status],
      });
    }
    const fixture =
      this.#downtime.get(resource) ??
      this.#downtime.get(fixtureKey(request.method));
    if (fixture === undefined) {
      this.#log("FETCH_DOWNTIME", resource, "DEPENDENCY_UNAVAILABLE");
      return fetchDowntimeResultSchema.parse({
        status: "DEPENDENCY_UNAVAILABLE",
        errorCode: "DEPENDENCY_UNAVAILABLE",
        explanation: SAFE_EXPLANATIONS.DEPENDENCY_UNAVAILABLE,
      });
    }
    this.#log(
      "FETCH_DOWNTIME",
      resource,
      fixture.active ? "ACTIVE" : "INACTIVE",
    );
    return fetchDowntimeResultSchema.parse({
      status: "AVAILABLE",
      downtime: { ...fixture, observedAt: context.requestedAt },
    });
  }

  async createPaymentLink(
    rawRequest: CreatePaymentLinkRequest,
    rawContext: PortContext,
  ): Promise<CreatePaymentLinkResult> {
    const request = createPaymentLinkRequestSchema.parse(rawRequest);
    const context = this.#context(rawContext);
    const failure = this.#consumeFailure(
      "CREATE_PAYMENT_LINK",
      request.referenceId,
    );
    if (
      failure === "PAYMENT_AUTHORIZED_BEFORE_CREATE" ||
      failure === "PAYMENT_CAPTURED_BEFORE_CREATE"
    ) {
      this.setPaymentStatus(
        request.paymentId,
        failure === "PAYMENT_AUTHORIZED_BEFORE_CREATE"
          ? "AUTHORIZED"
          : "CAPTURED",
      );
      const payment = this.#payments.get(request.paymentId)!;
      this.#log(
        "CREATE_PAYMENT_LINK",
        request.referenceId,
        "PAYMENT_STATE_CHANGED",
      );
      return createPaymentLinkResultSchema.parse({
        status: "PAYMENT_STATE_CHANGED",
        errorCode: "ALREADY_PAID",
        payment: { ...payment, fetchedAt: context.requestedAt },
      });
    }
    if (failure !== undefined) {
      const status =
        failure === "TIMEOUT"
          ? "TIMEOUT"
          : failure === "INVALID_RESPONSE"
            ? "INVALID_RESPONSE"
            : "DEPENDENCY_UNAVAILABLE";
      const errorCode = status === "TIMEOUT" ? "OUTCOME_UNCERTAIN" : status;
      this.#log("CREATE_PAYMENT_LINK", request.referenceId, status);
      return createPaymentLinkResultSchema.parse({
        status,
        errorCode,
        explanation: SAFE_EXPLANATIONS[status],
      });
    }
    const existing = this.#linksByReference.get(request.referenceId);
    if (existing !== undefined) {
      const identical =
        existing.caseReference === request.caseReference &&
        existing.orderId === request.orderId &&
        existing.amountSubunits === request.amountSubunits &&
        existing.currency === request.currency &&
        existing.expiresAt === request.expiresAt;
      if (!identical) {
        this.#log(
          "CREATE_PAYMENT_LINK",
          request.referenceId,
          "REFERENCE_CONFLICT",
        );
        return createPaymentLinkResultSchema.parse({
          status: "REFERENCE_CONFLICT",
          errorCode: "REFERENCE_CONFLICT",
          explanation: SAFE_EXPLANATIONS.REFERENCE_CONFLICT,
        });
      }
      this.#log("CREATE_PAYMENT_LINK", request.referenceId, "EXISTING");
      return createPaymentLinkResultSchema.parse({
        status: "EXISTING",
        paymentLink: clone(existing),
      });
    }
    const id = externalLinkId(request.referenceId);
    const link = adapterPaymentLinkSchema.parse({
      externalLinkId: id,
      publicUrl: `https://mock.razorpay.local/payment-links/${id}`,
      referenceId: request.referenceId,
      caseReference: request.caseReference,
      orderId: request.orderId,
      amountSubunits: request.amountSubunits,
      currency: request.currency,
      status: "CREATED",
      amountPaidSubunits: 0,
      createdAt: request.requestedAt,
      expiresAt: request.expiresAt,
      updatedAt: request.requestedAt,
    });
    this.#storeLink(link);
    this.#log("CREATE_PAYMENT_LINK", request.referenceId, "CREATED");
    return createPaymentLinkResultSchema.parse({
      status: "CREATED",
      paymentLink: clone(link),
    });
  }

  async fetchPaymentLink(
    rawRequest: FetchPaymentLinkRequest,
    rawContext: PortContext,
  ): Promise<FetchPaymentLinkResult> {
    const request = fetchPaymentLinkRequestSchema.parse(rawRequest);
    this.#context(rawContext);
    const failure = this.#consumeFailure(
      "FETCH_PAYMENT_LINK",
      request.externalLinkId,
    );
    if (failure !== undefined) {
      const status =
        failure === "TIMEOUT"
          ? "TIMEOUT"
          : failure === "INVALID_RESPONSE"
            ? "INVALID_RESPONSE"
            : "DEPENDENCY_UNAVAILABLE";
      this.#log("FETCH_PAYMENT_LINK", request.externalLinkId, status);
      return fetchPaymentLinkResultSchema.parse({
        status,
        errorCode: status,
        explanation: SAFE_EXPLANATIONS[status],
      });
    }
    const link = this.#linksByExternalId.get(request.externalLinkId);
    if (link === undefined) {
      this.#log("FETCH_PAYMENT_LINK", request.externalLinkId, "NOT_FOUND");
      return fetchPaymentLinkResultSchema.parse({
        status: "NOT_FOUND",
        errorCode: "NOT_FOUND",
        explanation: SAFE_EXPLANATIONS.NOT_FOUND,
      });
    }
    this.#log("FETCH_PAYMENT_LINK", request.externalLinkId, "AVAILABLE");
    return fetchPaymentLinkResultSchema.parse({
      status: "AVAILABLE",
      paymentLink: clone(link),
    });
  }

  async cancelPaymentLink(
    rawRequest: CancelPaymentLinkRequest,
    rawContext: PortContext,
  ): Promise<CancelPaymentLinkResult> {
    const request = cancelPaymentLinkRequestSchema.parse(rawRequest);
    const context = this.#context(rawContext);
    const failure = this.#consumeFailure(
      "CANCEL_PAYMENT_LINK",
      request.externalLinkId,
    );
    if (failure === "LINK_PAID_BEFORE_CANCEL")
      this.setPaymentLinkStatus(
        request.externalLinkId,
        "PAID",
        context.requestedAt,
      );
    else if (failure !== undefined) {
      const status =
        failure === "TIMEOUT"
          ? "TIMEOUT"
          : failure === "INVALID_RESPONSE"
            ? "INVALID_RESPONSE"
            : "DEPENDENCY_UNAVAILABLE";
      const errorCode = status === "TIMEOUT" ? "OUTCOME_UNCERTAIN" : status;
      this.#log("CANCEL_PAYMENT_LINK", request.externalLinkId, status);
      return cancelPaymentLinkResultSchema.parse({
        status,
        errorCode,
        explanation: SAFE_EXPLANATIONS[status],
      });
    }
    const link = this.#linksByExternalId.get(request.externalLinkId);
    if (link === undefined) {
      this.#log("CANCEL_PAYMENT_LINK", request.externalLinkId, "NOT_FOUND");
      return cancelPaymentLinkResultSchema.parse({
        status: "NOT_FOUND",
        errorCode: "NOT_FOUND",
        explanation: SAFE_EXPLANATIONS.NOT_FOUND,
      });
    }
    const terminalStatus =
      link.status === "PAID"
        ? "ALREADY_PAID"
        : link.status === "PARTIALLY_PAID"
          ? "PARTIALLY_PAID"
          : link.status === "CANCELLED"
            ? "ALREADY_CANCELLED"
            : link.status === "EXPIRED"
              ? "EXPIRED"
              : null;
    if (terminalStatus !== null) {
      this.#log("CANCEL_PAYMENT_LINK", request.externalLinkId, terminalStatus);
      return cancelPaymentLinkResultSchema.parse({
        status: terminalStatus,
        errorCode: terminalStatus,
        paymentLink: clone(link),
      });
    }
    const cancelled = adapterPaymentLinkSchema.parse({
      ...link,
      status: "CANCELLED",
      updatedAt: context.requestedAt,
    });
    this.#storeLink(cancelled);
    this.#log("CANCEL_PAYMENT_LINK", request.externalLinkId, "CANCELLED");
    return cancelPaymentLinkResultSchema.parse({
      status: "CANCELLED",
      paymentLink: clone(cancelled),
    });
  }

  #context(rawContext: PortContext) {
    if (rawContext.signal.aborted)
      throw new DOMException("The operation was aborted.", "AbortError");
    return adapterCallContextSchema.parse({
      requestedAt: rawContext.requestedAt,
      timeoutMilliseconds: rawContext.timeoutMilliseconds,
    });
  }

  #consumeFailure(
    operation: MockOperation,
    resource: string,
  ): MockFailureMode | undefined {
    const key = `${operation}:${resource}`;
    const queue = this.#failures.get(key);
    const failure = queue?.shift();
    if (queue?.length === 0) this.#failures.delete(key);
    return failure;
  }

  #paymentFailure(
    failure: MockFailureMode,
    resource: string,
  ): FetchPaymentResult {
    const status =
      failure === "TIMEOUT"
        ? "TIMEOUT"
        : failure === "INVALID_RESPONSE"
          ? "INVALID_RESPONSE"
          : "DEPENDENCY_UNAVAILABLE";
    this.#log("FETCH_PAYMENT", resource, status);
    return fetchPaymentResultSchema.parse({
      status,
      errorCode: status,
      explanation: SAFE_EXPLANATIONS[status],
    });
  }

  #storeLink(link: AdapterPaymentLink) {
    const stored = clone(link);
    this.#linksByReference.set(stored.referenceId, stored);
    this.#linksByExternalId.set(stored.externalLinkId, stored);
  }

  #log(operation: MockOperation, resourceReference: string, outcome: string) {
    this.#callLog.push(
      mockCallLogEntrySchema.parse({
        sequence: this.#callLog.length + 1,
        operation,
        resourceReference,
        outcome,
      }),
    );
  }
}
