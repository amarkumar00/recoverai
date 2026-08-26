import { createHash } from "node:crypto";

import {
  fetchPaymentResultSchema,
  type AdapterPayment,
} from "@/adapters/razorpay/contracts";
import type { AuditAppendResult } from "@/audit";
import type { PaymentSatisfactionContext } from "@/domain/payment-satisfaction";
import type { NormalizedPaymentStatus } from "@/domain/payments";
import type { PaymentId } from "@/domain/primitives";
import { policyDecisionSchema } from "@/domain/policy";
import type { RazorpayCapabilityPort } from "@/ports/razorpay";
import {
  paymentReconciliationRequestSchema,
  paymentReconciliationResultSchema,
  type PaymentReconciliationRequest,
  type PaymentReconciliationResult,
} from "@/reconciliation/contracts";
import { RecoveryActionExecutor } from "@/recovery/action-executor";
import { transitionRecoveryCase } from "@/recovery/transition-service";
import type {
  PersistedPaymentSnapshot,
  RecoveryCaseRecord,
} from "@/repositories/contracts";
import type { RecoverAiRepositories } from "@/repositories/interfaces";

type AuditAppender = { append(command: unknown): AuditAppendResult };

const RECONCILABLE_EVENTS = new Set([
  "payment.failed",
  "payment.authorized",
  "payment.captured",
  "order.paid",
]);
const SATISFIED_STATUSES = new Set<NormalizedPaymentStatus>([
  "AUTHORIZED",
  "CAPTURED",
]);

function identifier(kind: string, values: unknown) {
  const digest = createHash("sha256")
    .update(`recoverai_reconcile_v1:${kind}:${JSON.stringify(values)}`)
    .digest("hex")
    .slice(0, 32);
  return `ra_reconcile_${kind}_${digest}`;
}

function caseForEvent(
  repositories: RecoverAiRepositories,
  event: PaymentReconciliationRequest["event"]["event"],
):
  | { status: "RESOLVED"; recoveryCase: RecoveryCaseRecord | null }
  | {
      status: "CONFLICT";
    } {
  if (event.paymentId !== undefined) {
    const recoveryCase = repositories.recoveryCases.findByPaymentId(
      event.paymentId,
    );
    if (
      recoveryCase !== null &&
      event.orderId !== undefined &&
      recoveryCase.orderId !== event.orderId
    ) {
      return { status: "CONFLICT" };
    }
    return { status: "RESOLVED", recoveryCase };
  }
  if (event.orderId === undefined)
    return { status: "RESOLVED", recoveryCase: null };
  const matches = repositories.recoveryCases.listByOrderId(event.orderId);
  return matches.length > 1
    ? { status: "CONFLICT" }
    : { status: "RESOLVED", recoveryCase: matches[0] ?? null };
}

function paymentIdFor(
  event: PaymentReconciliationRequest["event"]["event"],
  recoveryCase: RecoveryCaseRecord | null,
) {
  return event.paymentId ?? recoveryCase?.paymentId;
}

function satisfaction(
  eventName: string,
  payment: AdapterPayment,
): PaymentSatisfactionContext {
  if (payment.status === "AUTHORIZED") {
    return {
      status: "SATISFIED",
      basis: eventName === "order.paid" ? "ORDER_PAID" : "PAYMENT_AUTHORIZED",
      verifiedAt: payment.fetchedAt,
    };
  }
  if (payment.status === "CAPTURED") {
    return {
      status: "SATISFIED",
      basis: eventName === "order.paid" ? "ORDER_PAID" : "PAYMENT_CAPTURED",
      verifiedAt: payment.fetchedAt,
    };
  }
  return {
    status: "UNSATISFIED",
    paymentStatus: payment.status as "CREATED" | "FAILED",
    verifiedAt: payment.fetchedAt,
  };
}

function validationConflict(input: {
  payment: AdapterPayment;
  event: PaymentReconciliationRequest["event"]["event"];
  recoveryCase: RecoveryCaseRecord | null;
  previous: PersistedPaymentSnapshot | null;
}): string | null {
  const { payment, event, recoveryCase, previous } = input;
  const eventSnapshot = event.paymentSnapshot;
  if (event.paymentId !== undefined && payment.paymentId !== event.paymentId)
    return "PAYMENT_ID_MISMATCH";
  if (event.orderId !== undefined && payment.orderId !== event.orderId)
    return "ORDER_ID_MISMATCH";
  if (eventSnapshot !== undefined) {
    if (payment.paymentId !== eventSnapshot.paymentId)
      return "PAYMENT_ID_MISMATCH";
    if (payment.orderId !== eventSnapshot.orderId) return "ORDER_ID_MISMATCH";
    if (payment.amountSubunits !== eventSnapshot.money.amountSubunits)
      return "AMOUNT_MISMATCH";
    if (payment.currency !== eventSnapshot.money.currency)
      return "CURRENCY_MISMATCH";
  }
  if (recoveryCase !== null) {
    if (payment.paymentId !== recoveryCase.paymentId)
      return "PAYMENT_ID_MISMATCH";
    if (payment.orderId !== recoveryCase.orderId) return "ORDER_ID_MISMATCH";
    if (payment.amountSubunits !== recoveryCase.verifiedUnpaidAmountSubunits)
      return "AMOUNT_MISMATCH";
    if (payment.currency !== recoveryCase.currency) return "CURRENCY_MISMATCH";
  }
  if (previous !== null) {
    if (payment.orderId !== previous.snapshot.orderId)
      return "PAYMENT_RELATIONSHIP_CONFLICT";
    if (payment.amountSubunits !== previous.snapshot.money.amountSubunits)
      return "AMOUNT_MISMATCH";
    if (payment.currency !== previous.snapshot.money.currency)
      return "CURRENCY_MISMATCH";
    if (
      SATISFIED_STATUSES.has(previous.snapshot.status) &&
      !SATISFIED_STATUSES.has(payment.status)
    ) {
      return "SATISFIED_STATE_REGRESSION";
    }
    if (
      previous.snapshot.status === "CAPTURED" &&
      payment.status === "AUTHORIZED"
    ) {
      return "CAPTURED_STATE_REGRESSION";
    }
  }
  return payment.status === "UNKNOWN" ? "UNKNOWN_CURRENT_STATE" : null;
}

type Invocation =
  | { status: "VALUE"; value: unknown }
  | { status: "TIMEOUT" }
  | { status: "INVALID_RESPONSE" };

async function invokePaymentFetch(input: {
  adapter: RazorpayCapabilityPort;
  paymentId: PaymentId;
  checkedAt: string;
  timeoutMilliseconds: number;
}): Promise<Invocation> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const valuePromise = Promise.resolve()
    .then(() =>
      input.adapter.fetchPayment(
        { paymentId: input.paymentId },
        {
          requestedAt: input.checkedAt,
          timeoutMilliseconds: input.timeoutMilliseconds,
          signal: controller.signal,
        },
      ),
    )
    .then((value) => ({ status: "VALUE" as const, value }))
    .catch(() => ({ status: "INVALID_RESPONSE" as const }));
  const timeoutPromise = new Promise<{ status: "TIMEOUT" }>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ status: "TIMEOUT" });
    }, input.timeoutMilliseconds);
  });
  const result = await Promise.race([valuePromise, timeoutPromise]);
  if (timer !== undefined) clearTimeout(timer);
  return result;
}

export class PaymentStateReconciler {
  readonly #adapter: RazorpayCapabilityPort;
  readonly #repositories: RecoverAiRepositories;
  readonly #audit: AuditAppender;

  constructor(dependencies: {
    adapter: RazorpayCapabilityPort;
    repositories: RecoverAiRepositories;
    audit: AuditAppender;
  }) {
    this.#adapter = dependencies.adapter;
    this.#repositories = dependencies.repositories;
    this.#audit = dependencies.audit;
  }

  async reconcile(rawRequest: unknown): Promise<PaymentReconciliationResult> {
    const parsed = paymentReconciliationRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      return paymentReconciliationResultSchema.parse({
        status: "FAILED_SAFE",
        eventId: "evt_invalid_reconciliation",
        resultCode: "INVALID_RECONCILIATION_INPUT",
        explanation:
          "The reconciliation request failed strict validation before provider access.",
      });
    }
    const request = parsed.data;
    const { event } = request.event;
    if (!RECONCILABLE_EVENTS.has(event.eventName)) {
      return this.#result(
        request,
        "IGNORED_EVENT",
        "EVENT_NOT_RECONCILABLE",
        "This event does not represent original-payment state and was not reconciled.",
      );
    }

    if (event.paymentSnapshot !== undefined) {
      const history = this.#repositories.paymentSnapshots.appendIdempotently({
        snapshot: event.paymentSnapshot,
        origin: "WEBHOOK_EVIDENCE",
        observedAt: event.receivedAt,
        sourceEventId: request.event.internalEventId,
        createdAt: event.receivedAt,
      });
      if (history.status === "CONFLICT") {
        return this.#conflict(request, "WEBHOOK_EVIDENCE_CONFLICT");
      }
    }

    const resolvedCase = caseForEvent(this.#repositories, event);
    if (resolvedCase.status === "CONFLICT") {
      return this.#conflict(request, "ORDER_RELATIONSHIP_CONFLICT");
    }
    const paymentId = paymentIdFor(event, resolvedCase.recoveryCase);
    if (paymentId === undefined) {
      this.#auditResult(
        request,
        "RECONCILIATION_NO_PAYMENT_TARGET",
        "No unique payment target was available for a current-state lookup.",
        undefined,
        resolvedCase.recoveryCase,
      );
      return this.#result(
        request,
        "NO_PAYMENT_TARGET",
        "NO_PAYMENT_TARGET",
        "No unique payment target was available, so recovery remained stopped.",
      );
    }

    const alreadyPersisted =
      this.#repositories.paymentSnapshots.findBySourceEventId(
        request.event.internalEventId,
        "PROVIDER_RECONCILED",
      );
    if (alreadyPersisted !== null) {
      return this.#resumeFromSnapshot(
        request,
        alreadyPersisted,
        resolvedCase.recoveryCase,
        true,
      );
    }

    const invocation = await invokePaymentFetch({
      adapter: this.#adapter,
      paymentId,
      checkedAt: request.checkedAt,
      timeoutMilliseconds: request.timeoutMilliseconds,
    });
    if (invocation.status !== "VALUE") {
      return this.#unavailable(request, invocation.status);
    }
    const fetched = fetchPaymentResultSchema.safeParse(invocation.value);
    if (!fetched.success || fetched.data.status !== "AVAILABLE") {
      return this.#unavailable(
        request,
        fetched.success ? fetched.data.status : "INVALID_RESPONSE",
      );
    }
    const payment = fetched.data.payment;
    const previous =
      this.#repositories.paymentSnapshots.findLatestReconciledByPaymentId(
        paymentId,
      );
    const conflict = validationConflict({
      payment,
      event,
      recoveryCase: resolvedCase.recoveryCase,
      previous,
    });
    if (conflict !== null)
      return this.#conflict(request, conflict, payment.status);

    const descriptive =
      event.paymentSnapshot ??
      previous?.snapshot ??
      this.#repositories.paymentSnapshots.findLatestByPaymentId(paymentId)
        ?.snapshot;
    const persisted = this.#repositories.paymentSnapshots.appendIdempotently({
      snapshot: {
        paymentId: payment.paymentId,
        orderId: payment.orderId,
        money: {
          amountSubunits: payment.amountSubunits,
          currency: payment.currency,
        },
        status: payment.status,
        method: descriptive?.method ?? "unknown",
        ...(descriptive?.bankOrProvider === undefined
          ? {}
          : { bankOrProvider: descriptive.bankOrProvider }),
        ...(payment.status === "FAILED" && descriptive?.failure !== undefined
          ? { failure: descriptive.failure }
          : {}),
        paymentCreatedAt:
          descriptive?.paymentCreatedAt ??
          resolvedCase.recoveryCase?.createdAt ??
          event.occurredAt,
      },
      origin: "PROVIDER_RECONCILED",
      observedAt: payment.fetchedAt,
      sourceEventId: request.event.internalEventId,
      createdAt: request.checkedAt,
    });
    if (persisted.status === "CONFLICT") {
      return this.#conflict(
        request,
        "RECONCILED_SNAPSHOT_CONFLICT",
        payment.status,
      );
    }
    return this.#resumeFromSnapshot(
      request,
      persisted.snapshot,
      resolvedCase.recoveryCase,
      persisted.status === "EXISTING",
    );
  }

  async #resumeFromSnapshot(
    request: PaymentReconciliationRequest,
    persisted: PersistedPaymentSnapshot,
    recoveryCase: RecoveryCaseRecord | null,
    replay: boolean,
  ): Promise<PaymentReconciliationResult> {
    const status = persisted.snapshot.status;
    this.#auditResult(
      request,
      "PAYMENT_STATE_RECONCILED",
      "Fetched provider state was persisted as current payment authority.",
      status,
      recoveryCase,
      persisted.createdAt,
    );
    if (!SATISFIED_STATUSES.has(status)) {
      return this.#result(
        request,
        replay ? "IDEMPOTENT_REPLAY" : "UNPAID_CONFIRMED",
        replay ? "RECONCILIATION_REPLAYED" : "CURRENT_PAYMENT_UNPAID",
        replay
          ? "The persisted current-state result was reused without another recovery effect."
          : "Current provider state confirms the payment remains unpaid; no action was executed.",
        status,
      );
    }
    if (recoveryCase === null) {
      return this.#result(
        request,
        "SATISFIED_NO_ACTIVE_CASE",
        "CURRENT_PAYMENT_SATISFIED",
        "Current provider state is satisfied and there is no active recovery case to stop.",
        status,
      );
    }
    return this.#stopRecovery(request, recoveryCase, persisted, replay);
  }

  async #stopRecovery(
    request: PaymentReconciliationRequest,
    initialCase: RecoveryCaseRecord,
    snapshot: PersistedPaymentSnapshot,
    replay: boolean,
  ): Promise<PaymentReconciliationResult> {
    const payment = snapshot.snapshot;
    const context = satisfaction(request.event.event.eventName, {
      paymentId: payment.paymentId,
      orderId: payment.orderId,
      amountSubunits: payment.money.amountSubunits,
      currency: payment.money.currency,
      status: payment.status,
      fetchedAt: snapshot.observedAt,
    });
    let current = this.#repositories.recoveryCases.findById(initialCase.caseId);
    if (current === null)
      return this.#conflict(request, "CASE_DISAPPEARED", payment.status);

    for (
      let attempt = 0;
      attempt < 3 &&
      !["RECOVERED", "STOPPED", "ESCALATED", "ERROR_SAFE"].includes(
        current.state,
      );
      attempt += 1
    ) {
      const transition = transitionRecoveryCase(
        this.#repositories.recoveryCases,
        {
          caseId: current.caseId,
          expectedCurrentState: current.state,
          requestedState: "STOPPED",
          expectedVersion: current.version,
          paymentSatisfaction: context,
          reasonCode: "ORIGINAL_PAYMENT_SATISFIED",
          reason:
            "Verified current original-payment success stops proactive recovery without capture.",
          transitionedAt: snapshot.observedAt,
        },
      );
      const refreshed = this.#repositories.recoveryCases.findById(
        current.caseId,
      );
      if (refreshed === null)
        return this.#conflict(request, "CASE_DISAPPEARED", payment.status);
      current = refreshed;
      if (
        transition.status === "APPLIED" ||
        transition.status === "IDEMPOTENT_NO_OP"
      )
        break;
      if (transition.status !== "VERSION_CONFLICT") {
        return this.#conflict(
          request,
          "STOPPING_TRANSITION_REJECTED",
          payment.status,
        );
      }
    }
    if (!["RECOVERED", "STOPPED"].includes(current.state)) {
      return this.#conflict(
        request,
        "TERMINAL_STATE_REQUIRES_REVIEW",
        payment.status,
      );
    }
    this.#auditResult(
      request,
      "RECOVERY_STOPPING_APPLIED",
      "Verified current original-payment success left the case in a legal stopping state.",
      payment.status,
      current,
      current.updatedAt,
      initialCase.state,
    );

    const blockingLink = this.#repositories.paymentLinks.findBlockingByOrderId(
      current.orderId,
    );
    if (blockingLink === null) {
      const terminalLink = this.#repositories.paymentLinks
        .listByCaseId(current.caseId)
        .at(-1);
      this.#auditResult(
        request,
        "LATE_SUCCESS_CANCELLATION_SKIPPED",
        terminalLink === undefined
          ? "No simulated recovery Payment Link exists, so cancellation was unnecessary."
          : `The simulated recovery Payment Link is already ${terminalLink.status.toLowerCase()} and was not cancelled.`,
        payment.status,
        current,
        current.updatedAt,
        current.state,
        terminalLink,
      );
      return this.#result(
        request,
        replay ? "IDEMPOTENT_REPLAY" : "RECOVERY_STOPPED",
        terminalLink === undefined
          ? "RECOVERY_STOPPED_NO_LINK"
          : `LINK_${terminalLink.status}_NOT_CANCELLED`,
        "Proactive recovery is stopped and no eligible unpaid simulated Payment Link required cancellation.",
        payment.status,
      );
    }

    const decision = policyDecisionSchema.parse({
      caseId: current.caseId,
      proposedAction: "CANCEL_RECOVERY_ALREADY_PAID",
      finalAction: "CANCEL_RECOVERY_ALREADY_PAID",
      outcome: "STOPPED",
      ruleId: "ORIGINAL_PAYMENT_SATISFIED",
      reason:
        "Verified original-payment success permits only bounded cancellation of one eligible unpaid simulated Payment Link.",
      checksPerformed: [
        {
          ruleId: "ORIGINAL_PAYMENT_SATISFIED",
          status: "PASSED",
          reason:
            "Current provider state confirms satisfaction and proactive recovery must stop.",
        },
      ],
      caseState: current.state,
      decidedAt: current.updatedAt,
    });
    const decisionId = identifier("decision", {
      caseId: current.caseId,
      stoppedAt: current.updatedAt,
      action: decision.finalAction,
    });
    const decisionRecord =
      this.#repositories.policyDecisions.insertIdempotently({
        decisionId,
        decision,
        createdAt: current.updatedAt,
      });
    if (decisionRecord.status === "CONFLICT") {
      return this.#conflict(
        request,
        "STOPPING_DECISION_CONFLICT",
        payment.status,
      );
    }
    const executor = new RecoveryActionExecutor({
      adapter: this.#adapter,
      repositories: this.#repositories,
      audit: this.#audit,
    });
    const execution = await executor.execute({
      caseRecord: current,
      decision: decisionRecord.decision.decision,
      intent: {
        action: "CANCEL_RECOVERY_ALREADY_PAID",
        recoveryLinkId: blockingLink.recoveryLinkId,
      },
      executedAt: current.updatedAt,
      timeoutMilliseconds: request.timeoutMilliseconds,
    });
    const needsReview = [
      "INVALID_INPUT",
      "POLICY_REJECTED",
      "FAILED_SAFE",
      "AUDIT_INCOMPLETE",
      "HUMAN_REVIEW_REQUIRED",
      "IN_PROGRESS",
    ].includes(execution.status);
    this.#auditResult(
      request,
      needsReview
        ? "LATE_SUCCESS_CANCELLATION_REVIEW_REQUIRED"
        : "LATE_SUCCESS_CANCELLATION_RESOLVED",
      needsReview
        ? "The simulated recovery Payment Link could not be cancelled safely and requires review."
        : "The eligible simulated recovery Payment Link reached a safe cancellation outcome.",
      payment.status,
      current,
      current.updatedAt,
      current.state,
      ("paymentLink" in execution ? execution.paymentLink : undefined) ??
        blockingLink,
    );
    return this.#result(
      request,
      needsReview
        ? "STOPPED_REVIEW_REQUIRED"
        : replay
          ? "IDEMPOTENT_REPLAY"
          : "RECOVERY_STOPPED",
      needsReview
        ? `LINK_CANCELLATION_${execution.resultCode}`
        : execution.resultCode,
      needsReview
        ? "Proactive recovery is stopped; simulated Payment Link state requires safe review."
        : "Proactive recovery is stopped and the simulated Payment Link was handled without duplicate cancellation.",
      payment.status,
    );
  }

  #unavailable(request: PaymentReconciliationRequest, code: string) {
    this.#auditResult(
      request,
      "CURRENT_PAYMENT_STATE_UNAVAILABLE",
      "Current provider state could not be verified; no recovery action was started.",
    );
    return this.#result(
      request,
      "CURRENT_STATE_UNAVAILABLE",
      "CURRENT_STATE_UNAVAILABLE",
      `Current payment state is unavailable (${code}); RecoverAI failed closed without action.`,
    );
  }

  #conflict(
    request: PaymentReconciliationRequest,
    code: string,
    currentStatus?: NormalizedPaymentStatus,
  ) {
    this.#auditResult(
      request,
      "CURRENT_PAYMENT_STATE_CONFLICT",
      "Current identity, money, relationship, or state evidence conflicts; recovery was not activated.",
      currentStatus,
    );
    return this.#result(
      request,
      "CURRENT_STATE_CONFLICT",
      code,
      "Trusted current-state evidence conflicts, so RecoverAI failed closed for safe review.",
      currentStatus,
    );
  }

  #auditResult(
    request: PaymentReconciliationRequest,
    eventType: string,
    reason: string,
    currentStatus?: NormalizedPaymentStatus,
    recoveryCase?: RecoveryCaseRecord | null,
    timestamp = request.checkedAt,
    previousState?: RecoveryCaseRecord["state"],
    link?: { recoveryLinkId: string },
  ) {
    const result = this.#audit.append({
      entryId: identifier("audit", {
        sourceEventId: request.event.internalEventId,
        eventType,
        caseId: recoveryCase?.caseId ?? null,
        linkId: link?.recoveryLinkId ?? null,
      }),
      timestamp,
      actor: "STATE_RECONCILER",
      inputReference: request.event.internalEventId,
      eventType,
      reason,
      previousState: previousState ?? recoveryCase?.state ?? null,
      newState: recoveryCase?.state ?? null,
      metadata: {
        eventId: request.event.internalEventId,
        ...(recoveryCase === null || recoveryCase === undefined
          ? {}
          : {
              caseId: recoveryCase.caseId,
              paymentId: recoveryCase.paymentId,
              orderId: recoveryCase.orderId,
            }),
        ...(link === undefined ? {} : { recoveryLinkId: link.recoveryLinkId }),
        webhookStatus: request.event.event.eventName,
        ...(currentStatus === undefined ? {} : { currentStatus }),
        isSynthetic: true,
      },
    });
    if (result.status !== "APPENDED" && result.status !== "IDEMPOTENT_REPLAY") {
      throw new Error("Reconciliation audit append failed safely.");
    }
  }

  #result(
    request: PaymentReconciliationRequest,
    status: PaymentReconciliationResult["status"],
    resultCode: string,
    explanation: string,
    currentStatus?: NormalizedPaymentStatus,
  ) {
    return paymentReconciliationResultSchema.parse({
      status,
      eventId: request.event.internalEventId,
      resultCode,
      explanation,
      ...(currentStatus === undefined ? {} : { currentStatus }),
    });
  }
}
