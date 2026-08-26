import "server-only";

import { z } from "zod";

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
} from "@/adapters/razorpay/contracts";
import type { TestModeLinkAttemptBudget } from "@/adapters/razorpay/test-mode-attempt-budget";
import type {
  RazorpayTestModeTransport,
  TransportFailureCode,
  TransportOptions,
  TransportResult,
} from "@/adapters/razorpay/test-mode-transport";
import type { RazorpayCapabilityPort } from "@/ports/razorpay";

const SAFE = {
  NOT_FOUND: "The requested Test Mode resource was not found.",
  TIMEOUT: "The Test Mode request timed out; no automatic retry was attempted.",
  DEPENDENCY_UNAVAILABLE: "Razorpay Test Mode is temporarily unavailable.",
  INVALID_RESPONSE:
    "Razorpay Test Mode returned an unsupported or malformed response.",
  AUTHENTICATION_REJECTED: "Razorpay Test Mode authentication was rejected.",
  RATE_LIMITED:
    "Razorpay Test Mode rejected the request due to a provider limit.",
  LOCAL_ATTEMPT_LIMIT_REACHED:
    "RecoverAI's local Test Mode Payment Link attempt limit has been reached.",
  OUTCOME_UNCERTAIN:
    "The Test Mode write outcome is uncertain and will not be retried automatically.",
  REFERENCE_CONFLICT:
    "The Test Mode Payment Link reference conflicts with trusted local values.",
} as const;

const providerId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_]+$/);
const unixSeconds = z.number().int().nonnegative().safe();
const providerPaymentSchema = z
  .object({
    id: providerId,
    order_id: providerId,
    amount: z.number().int().positive().safe(),
    currency: z.string().length(3),
    status: z.string().trim().min(1).max(32),
    error_code: z.string().trim().min(1).max(128).nullable().optional(),
    error_source: z.string().trim().min(1).max(128).nullable().optional(),
    error_step: z.string().trim().min(1).max(128).nullable().optional(),
    error_reason: z.string().trim().min(1).max(128).nullable().optional(),
  })
  .passthrough();

const providerDowntimeSchema = z
  .object({
    id: providerId,
    entity: z.literal("payment.downtime"),
    method: z.string().trim().min(1).max(32),
    status: z.string().trim().min(1).max(32),
    begin: unixSeconds,
    end: unixSeconds.nullable().optional(),
    instrument: z
      .object({
        bank: z.string().trim().min(1).max(128).optional(),
        wallet: z.string().trim().min(1).max(128).optional(),
        issuer: z.string().trim().min(1).max(128).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
const downtimeItemsSchema = z
  .object({
    entity: z.literal("collection"),
    count: z.number().int().nonnegative().safe(),
    items: z.array(providerDowntimeSchema).max(1_000),
  })
  .passthrough();
const downtimeCollectionSchema = z.union([
  downtimeItemsSchema,
  z
    .object({
      payment_downtime: z
        .object({
          entity: z.literal("collection"),
          count: z.number().int().nonnegative().safe(),
          items: z.array(providerDowntimeSchema).max(1_000),
        })
        .passthrough(),
    })
    .passthrough(),
]);

const providerPaymentLinkSchema = z
  .object({
    id: providerId,
    amount: z.number().int().positive().safe(),
    amount_paid: z.number().int().nonnegative().safe(),
    currency: z.string().length(3),
    reference_id: z.string().trim().min(1).max(40),
    status: z.string().trim().min(1).max(32),
    short_url: z.url().refine((value) => value.startsWith("https://rzp.io/")),
    created_at: unixSeconds,
    expire_by: unixSeconds,
    updated_at: unixSeconds.optional(),
  })
  .passthrough();

type PortContext = Parameters<RazorpayCapabilityPort["fetchPayment"]>[1];

function timestamp(seconds: number) {
  return new Date(seconds * 1_000).toISOString();
}

function transportOptions(context: PortContext): TransportOptions {
  const parsed = adapterCallContextSchema.parse({
    requestedAt: context.requestedAt,
    timeoutMilliseconds: context.timeoutMilliseconds,
  });
  return {
    signal: context.signal,
    timeoutMilliseconds: parsed.timeoutMilliseconds,
  };
}

function failureCode(code: TransportFailureCode) {
  return code === "AUTHENTICATION_REJECTED" || code === "RATE_LIMITED"
    ? code
    : code === "NOT_FOUND" || code === "TIMEOUT" || code === "INVALID_RESPONSE"
      ? code
      : "DEPENDENCY_UNAVAILABLE";
}

function readFailure(result: TransportResult) {
  if (result.status === "OK") return null;
  const code = failureCode(result.code);
  return { code, explanation: SAFE[code] } as const;
}

function paymentStatus(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "created") return "CREATED" as const;
  if (normalized === "authorized") return "AUTHORIZED" as const;
  if (normalized === "captured") return "CAPTURED" as const;
  if (normalized === "failed") return "FAILED" as const;
  return null;
}

function linkStatus(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "created") return "CREATED" as const;
  if (normalized === "partially_paid") return "PARTIALLY_PAID" as const;
  if (normalized === "paid") return "PAID" as const;
  if (normalized === "cancelled") return "CANCELLED" as const;
  if (normalized === "expired") return "EXPIRED" as const;
  return null;
}

export class RazorpayTestModeAdapter implements RazorpayCapabilityPort {
  readonly #transport: RazorpayTestModeTransport;
  readonly #budget: TestModeLinkAttemptBudget;
  readonly #writesEnabled: boolean;
  readonly #verifyCaseBeforeCreate: (
    request: CreatePaymentLinkRequest,
  ) => boolean;
  readonly #linksByReference = new Map<string, AdapterPaymentLink>();

  constructor(input: {
    transport: RazorpayTestModeTransport;
    attemptBudget: TestModeLinkAttemptBudget;
    writesEnabled: boolean;
    verifyCaseBeforeCreate: (request: CreatePaymentLinkRequest) => boolean;
  }) {
    this.#transport = input.transport;
    this.#budget = input.attemptBudget;
    this.#writesEnabled = input.writesEnabled;
    this.#verifyCaseBeforeCreate = input.verifyCaseBeforeCreate;
  }

  async fetchPayment(
    rawRequest: FetchPaymentRequest,
    context: PortContext,
  ): Promise<FetchPaymentResult> {
    const request = fetchPaymentRequestSchema.parse(rawRequest);
    const result = await this.#transport.fetchPayment(
      request.paymentId,
      transportOptions(context),
    );
    const failure = readFailure(result);
    if (failure !== null) {
      const status =
        failure.code === "NOT_FOUND"
          ? "NOT_FOUND"
          : failure.code === "TIMEOUT"
            ? "TIMEOUT"
            : failure.code === "INVALID_RESPONSE"
              ? "INVALID_RESPONSE"
              : "DEPENDENCY_UNAVAILABLE";
      return fetchPaymentResultSchema.parse({
        status,
        errorCode: failure.code,
        explanation: failure.explanation,
      });
    }
    if (result.status !== "OK") throw new Error("Unreachable transport state.");
    const parsed = providerPaymentSchema.safeParse(result.body);
    if (!parsed.success || parsed.data.id !== request.paymentId) {
      return fetchPaymentResultSchema.parse({
        status: "INVALID_RESPONSE",
        errorCode: "INVALID_RESPONSE",
        explanation: SAFE.INVALID_RESPONSE,
      });
    }
    const status = paymentStatus(parsed.data.status);
    if (status === null) {
      return fetchPaymentResultSchema.parse({
        status: "INVALID_RESPONSE",
        errorCode: "INVALID_RESPONSE",
        explanation: SAFE.INVALID_RESPONSE,
      });
    }
    const failureFields = {
      ...(parsed.data.error_code == null
        ? {}
        : { code: parsed.data.error_code }),
      ...(parsed.data.error_source == null
        ? {}
        : { source: parsed.data.error_source }),
      ...(parsed.data.error_step == null
        ? {}
        : { step: parsed.data.error_step }),
      ...(parsed.data.error_reason == null
        ? {}
        : { reason: parsed.data.error_reason }),
    };
    return fetchPaymentResultSchema.parse({
      status: "AVAILABLE",
      payment: adapterPaymentSchema.parse({
        paymentId: parsed.data.id,
        orderId: parsed.data.order_id,
        amountSubunits: parsed.data.amount,
        currency: parsed.data.currency.toUpperCase(),
        status,
        ...(Object.keys(failureFields).length === 0
          ? {}
          : { failure: failureFields }),
        fetchedAt: context.requestedAt,
      }),
    });
  }

  async fetchDowntime(
    rawRequest: FetchDowntimeRequest,
    context: PortContext,
  ): Promise<FetchDowntimeResult> {
    const request = fetchDowntimeRequestSchema.parse(rawRequest);
    const result = await this.#transport.fetchDowntimes(
      transportOptions(context),
    );
    const failure = readFailure(result);
    if (failure !== null) {
      const status =
        failure.code === "TIMEOUT"
          ? "TIMEOUT"
          : failure.code === "INVALID_RESPONSE"
            ? "INVALID_RESPONSE"
            : "DEPENDENCY_UNAVAILABLE";
      return fetchDowntimeResultSchema.parse({
        status,
        errorCode: failure.code,
        explanation: failure.explanation,
      });
    }
    if (result.status !== "OK") throw new Error("Unreachable transport state.");
    const parsed = downtimeCollectionSchema.safeParse(result.body);
    if (!parsed.success) {
      return fetchDowntimeResultSchema.parse({
        status: "INVALID_RESPONSE",
        errorCode: "INVALID_RESPONSE",
        explanation: SAFE.INVALID_RESPONSE,
      });
    }
    const collectionInput =
      "payment_downtime" in parsed.data
        ? parsed.data.payment_downtime
        : parsed.data;
    const collection = downtimeItemsSchema.parse(collectionInput);
    if (collection.count !== collection.items.length) {
      return fetchDowntimeResultSchema.parse({
        status: "INVALID_RESPONSE",
        errorCode: "INVALID_RESPONSE",
        explanation: SAFE.INVALID_RESPONSE,
      });
    }
    const compatible = collection.items.filter((item) => {
      if (item.method !== request.method) return false;
      if (request.bankOrProvider === undefined) return true;
      const instrument = item.instrument;
      return [
        instrument?.bank,
        instrument?.wallet,
        instrument?.issuer,
      ].includes(request.bankOrProvider);
    });
    return fetchDowntimeResultSchema.parse({
      status: "AVAILABLE",
      downtime: {
        active: compatible.some(
          (item) => item.status.toLowerCase() === "started" && item.end == null,
        ),
        method: request.method,
        ...(request.bankOrProvider === undefined
          ? {}
          : { bankOrProvider: request.bankOrProvider }),
        observedAt: context.requestedAt,
      },
    });
  }

  async createPaymentLink(
    rawRequest: CreatePaymentLinkRequest,
    context: PortContext,
  ): Promise<CreatePaymentLinkResult> {
    const request = createPaymentLinkRequestSchema.parse(rawRequest);
    if (!this.#writesEnabled) {
      return createPaymentLinkResultSchema.parse({
        status: "DEPENDENCY_UNAVAILABLE",
        errorCode: "DEPENDENCY_UNAVAILABLE",
        explanation: "Test Mode writes require explicit server-side opt-in.",
      });
    }
    const requestedAt = new Date(request.requestedAt).getTime();
    const expiresAt = new Date(request.expiresAt).getTime();
    if (
      request.referenceId.length > 40 ||
      expiresAt - requestedAt < 15 * 60_000 ||
      expiresAt - requestedAt > 24 * 60 * 60_000
    ) {
      return createPaymentLinkResultSchema.parse({
        status: "INVALID_RESPONSE",
        errorCode: "INVALID_RESPONSE",
        explanation:
          "The trusted Payment Link expiry or reference is outside RecoverAI bounds.",
      });
    }
    const existing = this.#linksByReference.get(request.referenceId);
    const payment = await this.fetchPayment(
      { paymentId: request.paymentId },
      context,
    );
    if (payment.status !== "AVAILABLE") {
      return createPaymentLinkResultSchema.parse({
        status:
          payment.status === "TIMEOUT"
            ? "TIMEOUT"
            : payment.status === "INVALID_RESPONSE"
              ? "INVALID_RESPONSE"
              : "DEPENDENCY_UNAVAILABLE",
        errorCode:
          payment.status === "TIMEOUT"
            ? "OUTCOME_UNCERTAIN"
            : payment.errorCode,
        explanation: payment.explanation,
      });
    }
    if (
      payment.payment.status === "AUTHORIZED" ||
      payment.payment.status === "CAPTURED"
    ) {
      return createPaymentLinkResultSchema.parse({
        status: "PAYMENT_STATE_CHANGED",
        errorCode: "ALREADY_PAID",
        payment: payment.payment,
      });
    }
    if (
      (payment.payment.status !== "FAILED" &&
        payment.payment.status !== "CREATED") ||
      payment.payment.orderId !== request.orderId ||
      payment.payment.amountSubunits !== request.amountSubunits ||
      payment.payment.currency !== request.currency
    ) {
      return createPaymentLinkResultSchema.parse({
        status: "REFERENCE_CONFLICT",
        errorCode: "REFERENCE_CONFLICT",
        explanation: SAFE.REFERENCE_CONFLICT,
      });
    }
    if (!this.#verifyCaseBeforeCreate(request)) {
      return createPaymentLinkResultSchema.parse({
        status: "REFERENCE_CONFLICT",
        errorCode: "REFERENCE_CONFLICT",
        explanation:
          "The recovery case changed before Test Mode link creation.",
      });
    }
    const claim = this.#budget.claim(request.referenceId, request.requestedAt);
    if (claim.status === "EXISTING") {
      if (existing !== undefined && claim.outcome === "CREATED") {
        return createPaymentLinkResultSchema.parse({
          status: "EXISTING",
          paymentLink: existing,
        });
      }
      return createPaymentLinkResultSchema.parse({
        status:
          claim.outcome === "OUTCOME_UNCERTAIN"
            ? "TIMEOUT"
            : "DEPENDENCY_UNAVAILABLE",
        errorCode:
          claim.outcome === "OUTCOME_UNCERTAIN"
            ? "OUTCOME_UNCERTAIN"
            : "DEPENDENCY_UNAVAILABLE",
        explanation:
          claim.outcome === "OUTCOME_UNCERTAIN"
            ? SAFE.OUTCOME_UNCERTAIN
            : SAFE.DEPENDENCY_UNAVAILABLE,
      });
    }
    if (claim.status === "LIMIT_REACHED") {
      return createPaymentLinkResultSchema.parse({
        status: "DEPENDENCY_UNAVAILABLE",
        errorCode: "LOCAL_ATTEMPT_LIMIT_REACHED",
        explanation: SAFE.LOCAL_ATTEMPT_LIMIT_REACHED,
      });
    }
    const result = await this.#transport.createStandardPaymentLink(
      {
        amount: request.amountSubunits,
        currency: request.currency,
        accept_partial: false,
        reference_id: request.referenceId,
        description: request.description,
        expire_by: Math.floor(expiresAt / 1_000),
        notify: { sms: false, email: false },
        reminder_enable: false,
      },
      transportOptions(context),
    );
    if (result.status === "FAILED") {
      const uncertain = result.code === "TIMEOUT";
      this.#budget.recordOutcome(
        request.referenceId,
        uncertain ? "OUTCOME_UNCERTAIN" : "FAILED_SAFE",
        request.requestedAt,
      );
      const code = failureCode(result.code);
      return createPaymentLinkResultSchema.parse({
        status: uncertain
          ? "TIMEOUT"
          : code === "INVALID_RESPONSE"
            ? "INVALID_RESPONSE"
            : "DEPENDENCY_UNAVAILABLE",
        errorCode: uncertain ? "OUTCOME_UNCERTAIN" : code,
        explanation: uncertain ? SAFE.OUTCOME_UNCERTAIN : SAFE[code],
      });
    }
    const mapped = this.#mapLink(result.body, request, context.requestedAt);
    if (mapped === null || mapped.status !== "CREATED") {
      this.#budget.recordOutcome(
        request.referenceId,
        "FAILED_SAFE",
        request.requestedAt,
      );
      return createPaymentLinkResultSchema.parse({
        status: "INVALID_RESPONSE",
        errorCode: "INVALID_RESPONSE",
        explanation: SAFE.INVALID_RESPONSE,
      });
    }
    this.#budget.recordOutcome(
      request.referenceId,
      "CREATED",
      request.requestedAt,
    );
    this.#linksByReference.set(request.referenceId, mapped);
    return createPaymentLinkResultSchema.parse({
      status: "CREATED",
      paymentLink: mapped,
    });
  }

  async fetchPaymentLink(
    rawRequest: FetchPaymentLinkRequest,
    context: PortContext,
  ): Promise<FetchPaymentLinkResult> {
    const request = fetchPaymentLinkRequestSchema.parse(rawRequest);
    if (
      request.referenceId === undefined ||
      request.caseReference === undefined ||
      request.orderId === undefined ||
      request.amountSubunits === undefined ||
      request.currency === undefined
    ) {
      return fetchPaymentLinkResultSchema.parse({
        status: "INVALID_RESPONSE",
        errorCode: "INVALID_RESPONSE",
        explanation: SAFE.INVALID_RESPONSE,
      });
    }
    const result = await this.#transport.fetchPaymentLink(
      request.externalLinkId,
      transportOptions(context),
    );
    const failure = readFailure(result);
    if (failure !== null) {
      const status =
        failure.code === "NOT_FOUND"
          ? "NOT_FOUND"
          : failure.code === "TIMEOUT"
            ? "TIMEOUT"
            : failure.code === "INVALID_RESPONSE"
              ? "INVALID_RESPONSE"
              : "DEPENDENCY_UNAVAILABLE";
      return fetchPaymentLinkResultSchema.parse({
        status,
        errorCode: failure.code,
        explanation: failure.explanation,
      });
    }
    if (result.status !== "OK") throw new Error("Unreachable transport state.");
    const link = this.#mapLink(result.body, request, context.requestedAt);
    if (link === null || link.externalLinkId !== request.externalLinkId) {
      return fetchPaymentLinkResultSchema.parse({
        status: "INVALID_RESPONSE",
        errorCode: "INVALID_RESPONSE",
        explanation: SAFE.INVALID_RESPONSE,
      });
    }
    return fetchPaymentLinkResultSchema.parse({
      status: "AVAILABLE",
      paymentLink: link,
    });
  }

  async cancelPaymentLink(
    rawRequest: CancelPaymentLinkRequest,
    context: PortContext,
  ): Promise<CancelPaymentLinkResult> {
    const request = cancelPaymentLinkRequestSchema.parse(rawRequest);
    if (!this.#writesEnabled) {
      return cancelPaymentLinkResultSchema.parse({
        status: "DEPENDENCY_UNAVAILABLE",
        errorCode: "DEPENDENCY_UNAVAILABLE",
        explanation: "Test Mode writes require explicit server-side opt-in.",
      });
    }
    const fetched = await this.fetchPaymentLink(
      {
        externalLinkId: request.externalLinkId,
        referenceId: request.referenceId,
        caseReference: request.caseReference,
        orderId: request.orderId,
        amountSubunits: request.amountSubunits,
        currency: request.currency,
      },
      context,
    );
    if (fetched.status !== "AVAILABLE")
      return cancelPaymentLinkResultSchema.parse(fetched);
    const link = fetched.paymentLink;
    const terminal =
      link.status === "PAID"
        ? "ALREADY_PAID"
        : link.status === "PARTIALLY_PAID"
          ? "PARTIALLY_PAID"
          : link.status === "EXPIRED"
            ? "EXPIRED"
            : link.status === "CANCELLED"
              ? "ALREADY_CANCELLED"
              : null;
    if (terminal !== null || (link.amountPaidSubunits ?? 0) !== 0) {
      const status = terminal ?? "PARTIALLY_PAID";
      return cancelPaymentLinkResultSchema.parse({
        status,
        errorCode: status,
        paymentLink: link,
      });
    }
    const result = await this.#transport.cancelPaymentLink(
      request.externalLinkId,
      transportOptions(context),
    );
    if (result.status === "FAILED") {
      const code = failureCode(result.code);
      return cancelPaymentLinkResultSchema.parse({
        status:
          result.code === "TIMEOUT"
            ? "TIMEOUT"
            : code === "INVALID_RESPONSE"
              ? "INVALID_RESPONSE"
              : code === "NOT_FOUND"
                ? "NOT_FOUND"
                : "DEPENDENCY_UNAVAILABLE",
        errorCode: result.code === "TIMEOUT" ? "OUTCOME_UNCERTAIN" : code,
        explanation:
          result.code === "TIMEOUT" ? SAFE.OUTCOME_UNCERTAIN : SAFE[code],
      });
    }
    const mapped = this.#mapLink(result.body, request, context.requestedAt);
    if (mapped === null || mapped.status !== "CANCELLED") {
      return cancelPaymentLinkResultSchema.parse({
        status: "INVALID_RESPONSE",
        errorCode: "INVALID_RESPONSE",
        explanation: SAFE.INVALID_RESPONSE,
      });
    }
    return cancelPaymentLinkResultSchema.parse({
      status: "CANCELLED",
      paymentLink: mapped,
    });
  }

  #mapLink(
    body: unknown,
    trusted: {
      referenceId?: string | undefined;
      caseReference?: string | undefined;
      orderId?: string | undefined;
      amountSubunits?: number | undefined;
      currency?: string | undefined;
    },
    observedAt: string,
  ): AdapterPaymentLink | null {
    const parsed = providerPaymentLinkSchema.safeParse(body);
    if (
      !parsed.success ||
      trusted.referenceId === undefined ||
      trusted.caseReference === undefined ||
      trusted.orderId === undefined ||
      trusted.amountSubunits === undefined ||
      trusted.currency === undefined
    )
      return null;
    const value = parsed.data;
    const status = linkStatus(value.status);
    if (
      status === null ||
      value.reference_id !== trusted.referenceId ||
      value.amount !== trusted.amountSubunits ||
      value.currency.toUpperCase() !== trusted.currency ||
      value.amount_paid > value.amount
    )
      return null;
    return adapterPaymentLinkSchema.parse({
      externalLinkId: value.id,
      publicUrl: value.short_url,
      referenceId: value.reference_id,
      caseReference: trusted.caseReference,
      orderId: trusted.orderId,
      amountSubunits: value.amount,
      amountPaidSubunits: value.amount_paid,
      currency: value.currency.toUpperCase(),
      status,
      createdAt: timestamp(value.created_at),
      expiresAt: timestamp(value.expire_by),
      updatedAt:
        value.updated_at === undefined
          ? observedAt
          : timestamp(value.updated_at),
    });
  }
}
