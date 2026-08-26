import type { z } from "zod";

import {
  adapterPaymentLinkSchema,
  cancelPaymentLinkResultSchema,
  createPaymentLinkResultSchema,
  fetchDowntimeResultSchema,
  fetchPaymentLinkResultSchema,
  fetchPaymentResultSchema,
  type AdapterPayment,
  type AdapterPaymentLink,
} from "@/adapters/razorpay/contracts";
import type { AuditAppendResult } from "@/audit";
import type { RecoveryAction } from "@/domain/actions";
import type { RazorpayCapabilityPort } from "@/ports/razorpay";
import {
  recoveryExecutionCommandSchema,
  recoveryExecutionResultSchema,
  type RecoveryExecutionCommand,
  type RecoveryExecutionResult,
} from "@/recovery/execution-contracts";
import { executionIdentifiers } from "@/recovery/idempotency";
import type {
  PaymentLinkRecord,
  RecoveryActionRecord,
} from "@/repositories/contracts";
import type { RecoverAiRepositories } from "@/repositories/interfaces";

type AuditAppender = { append(command: unknown): AuditAppendResult };
type ExecutorDependencies = {
  adapter: RazorpayCapabilityPort;
  repositories: RecoverAiRepositories;
  audit: AuditAppender;
};

type Invocation<T> =
  | { status: "VALUE"; value: T }
  | { status: "TIMEOUT" }
  | { status: "INVALID_RESPONSE" };

const SAFE = {
  INVALID_INPUT:
    "The execution command failed strict validation before any adapter operation.",
  POLICY_REJECTED: "The policy decision does not authorize execution.",
  IN_PROGRESS: "The same recovery action is already requested or started.",
  REPLAY:
    "The persisted recovery-action result was returned without another adapter operation.",
  PAYMENT_UNAVAILABLE:
    "Current payment state could not be verified safely; execution stopped without retry.",
  PAYMENT_MISMATCH:
    "Current payment identity or verified money no longer matches the recovery case.",
  ALREADY_PAID:
    "The payment is now authorized or captured, so Payment Link creation was stopped.",
  LINK_CREATED:
    "A deterministic mock Payment Link was prepared and persisted; no customer message was sent.",
  LINK_REUSED:
    "The existing eligible Payment Link was reused without creating or sending another link.",
  LINK_CONFLICT:
    "An existing Payment Link conflicts with the trusted case or money values.",
  OUTCOME_UNCERTAIN:
    "The adapter outcome is uncertain; no automatic retry will be attempted.",
  WAIT: "Verified active downtime supports a bounded internal wait result; no timer or message was created.",
  DOWNTIME_UNAVAILABLE:
    "Downtime context is unavailable, so RecoverAI did not guess and requires review.",
  STOPPED:
    "The non-retryable recovery action was recorded without an external operation.",
  ESCALATED:
    "Human review is required; no external financial operation or customer contact occurred.",
  CANCELLED: "The eligible unpaid mock Payment Link was cancelled once.",
  TERMINAL:
    "The Payment Link is already terminal; no repeated cancellation was attempted.",
  PARTIAL:
    "The Payment Link is partially paid and requires human review; cancellation was not attempted again.",
  AUDIT:
    "Audit completion failed safely; no automatic financial-operation retry was attempted.",
} as const;

export class RecoveryActionExecutor {
  readonly #adapter: RazorpayCapabilityPort;
  readonly #repositories: RecoverAiRepositories;
  readonly #audit: AuditAppender;

  constructor(dependencies: ExecutorDependencies) {
    this.#adapter = dependencies.adapter;
    this.#repositories = dependencies.repositories;
    this.#audit = dependencies.audit;
  }

  async execute(rawCommand: unknown): Promise<RecoveryExecutionResult> {
    const parsed = recoveryExecutionCommandSchema.safeParse(rawCommand);
    if (!parsed.success) {
      return recoveryExecutionResultSchema.parse({
        status: "INVALID_INPUT",
        resultCode: "INVALID_INPUT",
        explanation: SAFE.INVALID_INPUT,
      });
    }
    const command = parsed.data;
    const ids = executionIdentifiers(command);
    const proposedAction = command.intent.action;

    if (
      !this.#appendAudit(
        command,
        ids.auditEntryId("requested"),
        proposedAction,
        "EXECUTION_REQUESTED",
        "A validated policy-bounded execution was requested.",
        "REQUESTED",
      )
    ) {
      return this.#result(
        command,
        proposedAction,
        "AUDIT_INCOMPLETE",
        "AUDIT_REQUEST_FAILED",
        SAFE.AUDIT,
      );
    }

    if (
      command.decision.outcome === "BLOCKED" ||
      command.decision.finalAction === undefined
    ) {
      this.#appendAudit(
        command,
        ids.auditEntryId("policy_rejected"),
        proposedAction,
        "EXECUTION_POLICY_REJECTED",
        "The policy decision did not authorize an executable final action.",
        "POLICY_REJECTED",
      );
      return this.#result(
        command,
        proposedAction,
        "POLICY_REJECTED",
        "POLICY_REJECTED",
        SAFE.POLICY_REJECTED,
      );
    }

    const action = command.decision.finalAction;
    const claim = this.#repositories.recoveryActions.recordIdempotently({
      actionRecordId: ids.actionRecordId,
      caseId: command.caseRecord.caseId,
      action,
      status: "REQUESTED",
      idempotencyKey: ids.idempotencyKey,
      attemptCount: 0,
      requestedAt: command.executedAt,
      createdAt: command.executedAt,
      updatedAt: command.executedAt,
    });
    if (
      !this.#appendAudit(
        command,
        ids.auditEntryId(`claim_${claim.status.toLowerCase()}`),
        action,
        "ACTION_CLAIM_RECORDED",
        "The deterministic recovery-action claim was recorded.",
        claim.status,
      )
    ) {
      if (claim.status === "CREATED") {
        this.#repositories.recoveryActions.updateIfStatus({
          actionRecordId: ids.actionRecordId,
          expectedStatus: "REQUESTED",
          status: "FAILED_SAFE",
          attemptCount: 0,
          safeResultCode: "AUDIT_INCOMPLETE",
          safeErrorReason: SAFE.AUDIT,
          completedAt: command.executedAt,
          updatedAt: command.executedAt,
        });
      }
      return this.#result(
        command,
        action,
        "AUDIT_INCOMPLETE",
        "AUDIT_CLAIM_FAILED",
        SAFE.AUDIT,
        claim.action,
      );
    }

    if (claim.status === "EXISTING") {
      return this.#existingResult(
        command,
        action,
        claim.action,
        ids.paymentLinkReferenceId,
        ids.auditEntryId("replay_final"),
      );
    }

    const started = this.#repositories.recoveryActions.updateIfStatus({
      actionRecordId: ids.actionRecordId,
      expectedStatus: "REQUESTED",
      status: "STARTED",
      attemptCount: 1,
      startedAt: command.executedAt,
      updatedAt: command.executedAt,
    });
    if (started.status !== "UPDATED") {
      return this.#result(
        command,
        action,
        "IN_PROGRESS",
        "ACTION_CLAIM_LOST",
        SAFE.IN_PROGRESS,
        started.action ?? claim.action,
      );
    }

    switch (action) {
      case "STOP_NON_RETRYABLE":
        return this.#finish(
          command,
          action,
          started.action,
          "SUCCEEDED",
          "EXECUTED",
          "STOPPED_NON_RETRYABLE",
          SAFE.STOPPED,
          ids.auditEntryId("final"),
        );
      case "ESCALATE_HUMAN":
        return this.#finish(
          command,
          action,
          started.action,
          "SUCCEEDED",
          "HUMAN_REVIEW_REQUIRED",
          "HUMAN_REVIEW_REQUIRED",
          SAFE.ESCALATED,
          ids.auditEntryId("final"),
        );
      case "WAIT_FOR_RECOVERY":
        return this.#executeWait(command, started.action, ids);
      case "SEND_PAYMENT_LINK":
      case "REQUEST_METHOD_CHANGE":
        return this.#executeLinkAction(command, action, started.action, ids);
      case "CANCEL_RECOVERY_ALREADY_PAID":
        return this.#executeCancellation(command, started.action, ids);
    }
  }

  async #executeWait(
    command: RecoveryExecutionCommand,
    record: RecoveryActionRecord,
    ids: ReturnType<typeof executionIdentifiers>,
  ) {
    const payment = await this.#fetchPayment(
      command,
      record,
      ids,
      "wait_payment",
    );
    if (payment.status !== "AVAILABLE") {
      return this.#finish(
        command,
        "WAIT_FOR_RECOVERY",
        record,
        "FAILED_SAFE",
        "FAILED_SAFE",
        payment.resultCode,
        payment.explanation,
        ids.auditEntryId("final"),
      );
    }
    if (
      payment.payment.status === "AUTHORIZED" ||
      payment.payment.status === "CAPTURED"
    ) {
      return this.#finish(
        command,
        "WAIT_FOR_RECOVERY",
        record,
        "SUCCEEDED",
        "ALREADY_PAID_STOPPED",
        "ALREADY_PAID",
        SAFE.ALREADY_PAID,
        ids.auditEntryId("final"),
      );
    }
    const lookup = command.downtimeLookup!;
    if (
      !this.#appendAudit(
        command,
        ids.auditEntryId("downtime_started"),
        "WAIT_FOR_RECOVERY",
        "ADAPTER_CALL_STARTED",
        "A bounded mock downtime lookup started.",
        "FETCH_DOWNTIME",
      )
    ) {
      return this.#finish(
        command,
        "WAIT_FOR_RECOVERY",
        record,
        "FAILED_SAFE",
        "AUDIT_INCOMPLETE",
        "AUDIT_INCOMPLETE",
        SAFE.AUDIT,
        ids.auditEntryId("final"),
      );
    }
    const invocation = await this.#invoke(
      fetchDowntimeResultSchema,
      command,
      (context) => this.#adapter.fetchDowntime(lookup, context),
    );
    if (invocation.status !== "VALUE") {
      const code =
        invocation.status === "TIMEOUT" ? "TIMEOUT" : "INVALID_RESPONSE";
      this.#appendAudit(
        command,
        ids.auditEntryId("downtime_failed"),
        "WAIT_FOR_RECOVERY",
        "ADAPTER_CALL_FAILED_SAFE",
        "The bounded mock downtime lookup failed safely.",
        code,
      );
      return this.#finish(
        command,
        "WAIT_FOR_RECOVERY",
        record,
        "FAILED_SAFE",
        "HUMAN_REVIEW_REQUIRED",
        "DOWNTIME_UNAVAILABLE",
        SAFE.DOWNTIME_UNAVAILABLE,
        ids.auditEntryId("final"),
      );
    }
    if (invocation.value.status !== "AVAILABLE") {
      const code = invocation.value.errorCode;
      this.#appendAudit(
        command,
        ids.auditEntryId("downtime_failed"),
        "WAIT_FOR_RECOVERY",
        "ADAPTER_CALL_FAILED_SAFE",
        "The bounded mock downtime lookup failed safely.",
        code,
      );
      return this.#finish(
        command,
        "WAIT_FOR_RECOVERY",
        record,
        "FAILED_SAFE",
        "HUMAN_REVIEW_REQUIRED",
        "DOWNTIME_UNAVAILABLE",
        SAFE.DOWNTIME_UNAVAILABLE,
        ids.auditEntryId("final"),
      );
    }
    this.#appendAudit(
      command,
      ids.auditEntryId("downtime_succeeded"),
      "WAIT_FOR_RECOVERY",
      "ADAPTER_CALL_SUCCEEDED",
      "The bounded mock downtime lookup completed.",
      invocation.value.downtime.active ? "ACTIVE" : "INACTIVE",
    );
    if (!invocation.value.downtime.active) {
      return this.#finish(
        command,
        "WAIT_FOR_RECOVERY",
        record,
        "FAILED_SAFE",
        "HUMAN_REVIEW_REQUIRED",
        "DOWNTIME_INACTIVE",
        SAFE.DOWNTIME_UNAVAILABLE,
        ids.auditEntryId("final"),
      );
    }
    return this.#finish(
      command,
      "WAIT_FOR_RECOVERY",
      record,
      "SUCCEEDED",
      "EXECUTED",
      "WAIT_RECORDED",
      SAFE.WAIT,
      ids.auditEntryId("final"),
    );
  }

  async #executeLinkAction(
    command: RecoveryExecutionCommand,
    action: "SEND_PAYMENT_LINK" | "REQUEST_METHOD_CHANGE",
    record: RecoveryActionRecord,
    ids: ReturnType<typeof executionIdentifiers>,
  ) {
    const payment = await this.#fetchPayment(
      command,
      record,
      ids,
      "link_payment",
    );
    if (payment.status !== "AVAILABLE") {
      return this.#finish(
        command,
        action,
        record,
        "FAILED_SAFE",
        "FAILED_SAFE",
        payment.resultCode,
        payment.explanation,
        ids.auditEntryId("final"),
      );
    }
    const validation = this.#validatePayment(command, payment.payment);
    if (validation === "ALREADY_PAID") {
      return this.#finish(
        command,
        action,
        record,
        "SUCCEEDED",
        "ALREADY_PAID_STOPPED",
        "ALREADY_PAID",
        SAFE.ALREADY_PAID,
        ids.auditEntryId("final"),
      );
    }
    if (validation !== "VALID") {
      return this.#finish(
        command,
        action,
        record,
        "FAILED_SAFE",
        "FAILED_SAFE",
        validation,
        SAFE.PAYMENT_MISMATCH,
        ids.auditEntryId("final"),
      );
    }
    const currentCaseCheck = this.#validateCurrentCase(command);
    if (currentCaseCheck !== "VALID") {
      return this.#finish(
        command,
        action,
        record,
        "FAILED_SAFE",
        "FAILED_SAFE",
        currentCaseCheck,
        SAFE.IN_PROGRESS,
        ids.auditEntryId("final"),
      );
    }
    const intent = command.intent;
    if (!("linkUse" in intent)) {
      return this.#finish(
        command,
        action,
        record,
        "FAILED_SAFE",
        "FAILED_SAFE",
        "INTENT_INVALID",
        SAFE.LINK_CONFLICT,
        ids.auditEntryId("final"),
      );
    }
    if (intent.linkUse.mode === "USE_EXISTING") {
      const existing = this.#repositories.paymentLinks.findByRecoveryLinkId(
        intent.linkUse.recoveryLinkId,
      );
      if (
        existing === null ||
        !this.#linkMatches(command, existing) ||
        existing.status !== "CREATED"
      ) {
        return this.#finish(
          command,
          action,
          record,
          "FAILED_SAFE",
          existing?.status === "PARTIALLY_PAID"
            ? "HUMAN_REVIEW_REQUIRED"
            : "FAILED_SAFE",
          existing?.status === "PARTIALLY_PAID"
            ? "PARTIALLY_PAID"
            : "EXISTING_LINK_INVALID",
          existing?.status === "PARTIALLY_PAID"
            ? SAFE.PARTIAL
            : SAFE.LINK_CONFLICT,
          ids.auditEntryId("final"),
          existing ?? undefined,
        );
      }
      return this.#finish(
        command,
        action,
        record,
        "SUCCEEDED",
        "LINK_REUSED",
        "EXISTING_LINK_REUSED",
        SAFE.LINK_REUSED,
        ids.auditEntryId("final"),
        existing,
      );
    }

    const byReference = this.#repositories.paymentLinks.findByReferenceId(
      ids.paymentLinkReferenceId,
    );
    if (byReference !== null) {
      if (
        this.#linkMatches(command, byReference) &&
        byReference.status === "CREATED"
      ) {
        return this.#finish(
          command,
          action,
          record,
          "SUCCEEDED",
          "LINK_REUSED",
          "EXISTING_LINK_REUSED",
          SAFE.LINK_REUSED,
          ids.auditEntryId("final"),
          byReference,
        );
      }
      return this.#finish(
        command,
        action,
        record,
        "FAILED_SAFE",
        "FAILED_SAFE",
        "REFERENCE_CONFLICT",
        SAFE.LINK_CONFLICT,
        ids.auditEntryId("final"),
        byReference,
      );
    }
    const blocking = this.#repositories.paymentLinks.findBlockingByOrderId(
      command.caseRecord.orderId,
    );
    if (blocking !== null) {
      const safeReuse =
        this.#linkMatches(command, blocking) && blocking.status === "CREATED";
      return this.#finish(
        command,
        action,
        record,
        safeReuse ? "SUCCEEDED" : "FAILED_SAFE",
        safeReuse
          ? "LINK_REUSED"
          : blocking.status === "PARTIALLY_PAID"
            ? "HUMAN_REVIEW_REQUIRED"
            : "FAILED_SAFE",
        safeReuse
          ? "BLOCKING_LINK_REUSED"
          : blocking.status === "PARTIALLY_PAID"
            ? "PARTIALLY_PAID"
            : "BLOCKING_LINK_CONFLICT",
        safeReuse
          ? SAFE.LINK_REUSED
          : blocking.status === "PARTIALLY_PAID"
            ? SAFE.PARTIAL
            : SAFE.LINK_CONFLICT,
        ids.auditEntryId("final"),
        blocking,
      );
    }

    const expiresAt =
      command.linkExpiresAt ?? command.caseRecord.recoveryWindowEndsAt;
    if (expiresAt === undefined || expiresAt <= command.executedAt) {
      return this.#finish(
        command,
        action,
        record,
        "FAILED_SAFE",
        "FAILED_SAFE",
        "LINK_EXPIRY_INVALID",
        SAFE.LINK_CONFLICT,
        ids.auditEntryId("final"),
      );
    }
    if (
      !this.#appendAudit(
        command,
        ids.auditEntryId("link_create_started"),
        action,
        "ADAPTER_CALL_STARTED",
        "A deterministic mock Payment Link creation started.",
        "CREATE_PAYMENT_LINK",
      )
    ) {
      return this.#finish(
        command,
        action,
        record,
        "FAILED_SAFE",
        "AUDIT_INCOMPLETE",
        "AUDIT_INCOMPLETE",
        SAFE.AUDIT,
        ids.auditEntryId("final"),
      );
    }
    const finalCaseCheck = this.#validateCurrentCase(command);
    if (finalCaseCheck !== "VALID") {
      return this.#finish(
        command,
        action,
        record,
        "FAILED_SAFE",
        "FAILED_SAFE",
        finalCaseCheck,
        SAFE.IN_PROGRESS,
        ids.auditEntryId("final"),
      );
    }
    const invocation = await this.#invoke(
      createPaymentLinkResultSchema,
      command,
      (context) =>
        this.#adapter.createPaymentLink(
          {
            referenceId: ids.paymentLinkReferenceId,
            caseReference: command.caseRecord.caseId,
            expectedCaseState: command.caseRecord.state,
            expectedCaseVersion: command.caseRecord.version,
            paymentId: command.caseRecord.paymentId,
            orderId: command.caseRecord.orderId,
            amountSubunits: command.caseRecord.verifiedUnpaidAmountSubunits,
            currency: command.caseRecord.currency,
            description: "RecoverAI synthetic/test payment recovery link",
            expiresAt,
            requestedAt: command.executedAt,
            metadata: { isSynthetic: true },
          },
          context,
        ),
    );
    if (invocation.status !== "VALUE") {
      const code =
        invocation.status === "TIMEOUT"
          ? "OUTCOME_UNCERTAIN"
          : "INVALID_RESPONSE";
      const auditOkay = this.#appendAudit(
        command,
        ids.auditEntryId("link_create_failed"),
        action,
        "ADAPTER_CALL_FAILED_SAFE",
        "Mock Payment Link creation failed safely without retry.",
        code,
      );
      const finished = this.#finish(
        command,
        action,
        record,
        "FAILED_SAFE",
        "FAILED_SAFE",
        code,
        code === "OUTCOME_UNCERTAIN"
          ? SAFE.OUTCOME_UNCERTAIN
          : SAFE.PAYMENT_UNAVAILABLE,
        ids.auditEntryId("final"),
      );
      return this.#postCallAuditResult(command, action, auditOkay, finished);
    }
    const adapterResult = invocation.value;
    if (adapterResult.status === "PAYMENT_STATE_CHANGED") {
      const auditOkay = this.#appendAudit(
        command,
        ids.auditEntryId("link_state_changed"),
        action,
        "ADAPTER_CALL_FAILED_SAFE",
        "The mock payment became satisfied immediately before link creation.",
        "ALREADY_PAID",
      );
      const finished = this.#finish(
        command,
        action,
        record,
        "SUCCEEDED",
        "ALREADY_PAID_STOPPED",
        "ALREADY_PAID",
        SAFE.ALREADY_PAID,
        ids.auditEntryId("final"),
      );
      return this.#postCallAuditResult(command, action, auditOkay, finished);
    }
    if (
      adapterResult.status !== "CREATED" &&
      adapterResult.status !== "EXISTING"
    ) {
      const code = adapterResult.errorCode;
      const auditOkay = this.#appendAudit(
        command,
        ids.auditEntryId("link_create_failed"),
        action,
        "ADAPTER_CALL_FAILED_SAFE",
        "Mock Payment Link creation returned a safe failure.",
        code,
      );
      const finished = this.#finish(
        command,
        action,
        record,
        "FAILED_SAFE",
        "FAILED_SAFE",
        code,
        code === "OUTCOME_UNCERTAIN"
          ? SAFE.OUTCOME_UNCERTAIN
          : SAFE.LINK_CONFLICT,
        ids.auditEntryId("final"),
      );
      return this.#postCallAuditResult(command, action, auditOkay, finished);
    }
    const localLink = this.#persistAdapterLink(
      command,
      ids.recoveryLinkId,
      adapterResult.paymentLink,
    );
    if (localLink === null) {
      return this.#finish(
        command,
        action,
        record,
        "FAILED_SAFE",
        "FAILED_SAFE",
        "LOCAL_LINK_CONFLICT",
        SAFE.LINK_CONFLICT,
        ids.auditEntryId("final"),
      );
    }
    const resultStatus =
      adapterResult.status === "EXISTING" ? "LINK_REUSED" : "EXECUTED";
    const resultCode =
      adapterResult.status === "EXISTING"
        ? "ADAPTER_LINK_REUSED"
        : "PAYMENT_LINK_CREATED";
    const explanation =
      adapterResult.status === "EXISTING"
        ? SAFE.LINK_REUSED
        : SAFE.LINK_CREATED;
    const auditOkay = this.#appendAudit(
      command,
      ids.auditEntryId("link_recorded"),
      action,
      "PAYMENT_LINK_RECORDED",
      "The mock Payment Link result was persisted without customer contact.",
      resultCode,
      localLink,
    );
    const finished = this.#finish(
      command,
      action,
      record,
      "SUCCEEDED",
      resultStatus,
      resultCode,
      explanation,
      ids.auditEntryId("final"),
      localLink,
    );
    return this.#postCallAuditResult(
      command,
      action,
      auditOkay,
      finished,
      localLink,
    );
  }

  async #executeCancellation(
    command: RecoveryExecutionCommand,
    record: RecoveryActionRecord,
    ids: ReturnType<typeof executionIdentifiers>,
  ) {
    const requestedId =
      command.intent.action === "CANCEL_RECOVERY_ALREADY_PAID"
        ? command.intent.recoveryLinkId
        : undefined;
    const local =
      requestedId === undefined
        ? this.#repositories.paymentLinks.findBlockingByOrderId(
            command.caseRecord.orderId,
          )
        : this.#repositories.paymentLinks.findByRecoveryLinkId(requestedId);
    if (
      local === null ||
      !this.#linkMatches(command, local) ||
      local.externalLinkId === undefined
    ) {
      return this.#finish(
        command,
        "CANCEL_RECOVERY_ALREADY_PAID",
        record,
        "FAILED_SAFE",
        "FAILED_SAFE",
        "LINK_NOT_FOUND",
        SAFE.LINK_CONFLICT,
        ids.auditEntryId("final"),
        local ?? undefined,
      );
    }
    if (local.status !== "CREATED")
      return this.#terminalLocalCancellation(command, record, ids, local);
    if (
      !this.#appendAudit(
        command,
        ids.auditEntryId("link_fetch_started"),
        "CANCEL_RECOVERY_ALREADY_PAID",
        "ADAPTER_CALL_STARTED",
        "The latest mock Payment Link status lookup started.",
        "FETCH_PAYMENT_LINK",
        local,
      )
    ) {
      return this.#finish(
        command,
        "CANCEL_RECOVERY_ALREADY_PAID",
        record,
        "FAILED_SAFE",
        "AUDIT_INCOMPLETE",
        "AUDIT_INCOMPLETE",
        SAFE.AUDIT,
        ids.auditEntryId("final"),
        local,
      );
    }
    const fetched = await this.#invoke(
      fetchPaymentLinkResultSchema,
      command,
      (context) =>
        this.#adapter.fetchPaymentLink(
          {
            externalLinkId: local.externalLinkId!,
            referenceId: local.referenceId,
            caseReference: local.caseId,
            orderId: local.orderId,
            amountSubunits: local.amountSubunits,
            currency: local.currency,
          },
          context,
        ),
    );
    if (fetched.status !== "VALUE" || fetched.value.status !== "AVAILABLE") {
      const code =
        fetched.status === "TIMEOUT"
          ? "OUTCOME_UNCERTAIN"
          : "LINK_STATUS_UNAVAILABLE";
      const auditOkay = this.#appendAudit(
        command,
        ids.auditEntryId("link_fetch_failed"),
        "CANCEL_RECOVERY_ALREADY_PAID",
        "ADAPTER_CALL_FAILED_SAFE",
        "The latest mock Payment Link status could not be verified safely.",
        code,
        local,
      );
      const finished = this.#finish(
        command,
        "CANCEL_RECOVERY_ALREADY_PAID",
        record,
        "FAILED_SAFE",
        "FAILED_SAFE",
        code,
        SAFE.OUTCOME_UNCERTAIN,
        ids.auditEntryId("final"),
        local,
      );
      return this.#postCallAuditResult(
        command,
        "CANCEL_RECOVERY_ALREADY_PAID",
        auditOkay,
        finished,
        local,
      );
    }
    if (
      !this.#appendAudit(
        command,
        ids.auditEntryId("link_fetch_succeeded"),
        "CANCEL_RECOVERY_ALREADY_PAID",
        "ADAPTER_CALL_SUCCEEDED",
        "The latest mock Payment Link status was verified before cancellation.",
        fetched.value.paymentLink.status,
        local,
      )
    ) {
      return this.#finish(
        command,
        "CANCEL_RECOVERY_ALREADY_PAID",
        record,
        "FAILED_SAFE",
        "AUDIT_INCOMPLETE",
        "AUDIT_INCOMPLETE",
        SAFE.AUDIT,
        ids.auditEntryId("final"),
        local,
      );
    }
    const synchronized = this.#synchronizeLocalLink(
      local,
      fetched.value.paymentLink,
      command.executedAt,
    );
    if (synchronized.status !== "CREATED")
      return this.#terminalLocalCancellation(
        command,
        record,
        ids,
        synchronized,
      );
    if (
      !this.#appendAudit(
        command,
        ids.auditEntryId("link_cancel_started"),
        "CANCEL_RECOVERY_ALREADY_PAID",
        "ADAPTER_CALL_STARTED",
        "Eligible mock Payment Link cancellation started.",
        "CANCEL_PAYMENT_LINK",
        synchronized,
      )
    ) {
      return this.#finish(
        command,
        "CANCEL_RECOVERY_ALREADY_PAID",
        record,
        "FAILED_SAFE",
        "AUDIT_INCOMPLETE",
        "AUDIT_INCOMPLETE",
        SAFE.AUDIT,
        ids.auditEntryId("final"),
        synchronized,
      );
    }
    const cancelled = await this.#invoke(
      cancelPaymentLinkResultSchema,
      command,
      (context) =>
        this.#adapter.cancelPaymentLink(
          {
            externalLinkId: synchronized.externalLinkId!,
            requestReference: ids.idempotencyKey,
            referenceId: synchronized.referenceId,
            caseReference: synchronized.caseId,
            orderId: synchronized.orderId,
            amountSubunits: synchronized.amountSubunits,
            currency: synchronized.currency,
          },
          context,
        ),
    );
    if (cancelled.status !== "VALUE") {
      const code =
        cancelled.status === "TIMEOUT"
          ? "OUTCOME_UNCERTAIN"
          : "INVALID_RESPONSE";
      const auditOkay = this.#appendAudit(
        command,
        ids.auditEntryId("link_cancel_failed"),
        "CANCEL_RECOVERY_ALREADY_PAID",
        "ADAPTER_CALL_FAILED_SAFE",
        "Mock Payment Link cancellation failed safely without retry.",
        code,
        synchronized,
      );
      const finished = this.#finish(
        command,
        "CANCEL_RECOVERY_ALREADY_PAID",
        record,
        "FAILED_SAFE",
        "FAILED_SAFE",
        code,
        SAFE.OUTCOME_UNCERTAIN,
        ids.auditEntryId("final"),
        synchronized,
      );
      return this.#postCallAuditResult(
        command,
        "CANCEL_RECOVERY_ALREADY_PAID",
        auditOkay,
        finished,
        synchronized,
      );
    }
    const result = cancelled.value;
    if (
      result.status === "CANCELLED" ||
      result.status === "ALREADY_CANCELLED" ||
      result.status === "EXPIRED" ||
      result.status === "ALREADY_PAID" ||
      result.status === "PARTIALLY_PAID"
    ) {
      const updated = this.#synchronizeLocalLink(
        synchronized,
        result.paymentLink,
        command.executedAt,
      );
      const auditOkay = this.#appendAudit(
        command,
        ids.auditEntryId("link_cancel_succeeded"),
        "CANCEL_RECOVERY_ALREADY_PAID",
        "ADAPTER_CALL_SUCCEEDED",
        "The mock Payment Link cancellation returned a sanitized lifecycle outcome.",
        result.status,
        updated,
      );
      const finished =
        result.status === "PARTIALLY_PAID"
          ? this.#finish(
              command,
              "CANCEL_RECOVERY_ALREADY_PAID",
              record,
              "SUCCEEDED",
              "HUMAN_REVIEW_REQUIRED",
              "PARTIALLY_PAID",
              SAFE.PARTIAL,
              ids.auditEntryId("final"),
              updated,
            )
          : result.status === "ALREADY_PAID"
            ? this.#finish(
                command,
                "CANCEL_RECOVERY_ALREADY_PAID",
                record,
                "SUCCEEDED",
                "ALREADY_PAID_STOPPED",
                "ALREADY_PAID",
                SAFE.ALREADY_PAID,
                ids.auditEntryId("final"),
                updated,
              )
            : result.status === "ALREADY_CANCELLED" ||
                result.status === "EXPIRED"
              ? this.#finish(
                  command,
                  "CANCEL_RECOVERY_ALREADY_PAID",
                  record,
                  "SUCCEEDED",
                  "NO_OP_TERMINAL",
                  result.status,
                  SAFE.TERMINAL,
                  ids.auditEntryId("final"),
                  updated,
                )
              : this.#finish(
                  command,
                  "CANCEL_RECOVERY_ALREADY_PAID",
                  record,
                  "SUCCEEDED",
                  "EXECUTED",
                  "PAYMENT_LINK_CANCELLED",
                  SAFE.CANCELLED,
                  ids.auditEntryId("final"),
                  updated,
                );
      return this.#postCallAuditResult(
        command,
        "CANCEL_RECOVERY_ALREADY_PAID",
        auditOkay,
        finished,
        updated,
      );
    }
    const auditOkay = this.#appendAudit(
      command,
      ids.auditEntryId("link_cancel_failed"),
      "CANCEL_RECOVERY_ALREADY_PAID",
      "ADAPTER_CALL_FAILED_SAFE",
      "Mock Payment Link cancellation returned a safe failure.",
      result.errorCode,
      synchronized,
    );
    const finished = this.#finish(
      command,
      "CANCEL_RECOVERY_ALREADY_PAID",
      record,
      "FAILED_SAFE",
      "FAILED_SAFE",
      result.errorCode,
      result.errorCode === "OUTCOME_UNCERTAIN"
        ? SAFE.OUTCOME_UNCERTAIN
        : SAFE.PAYMENT_UNAVAILABLE,
      ids.auditEntryId("final"),
      synchronized,
    );
    return this.#postCallAuditResult(
      command,
      "CANCEL_RECOVERY_ALREADY_PAID",
      auditOkay,
      finished,
      synchronized,
    );
  }

  #terminalLocalCancellation(
    command: RecoveryExecutionCommand,
    record: RecoveryActionRecord,
    ids: ReturnType<typeof executionIdentifiers>,
    link: PaymentLinkRecord,
  ) {
    if (link.status === "PARTIALLY_PAID")
      return this.#finish(
        command,
        "CANCEL_RECOVERY_ALREADY_PAID",
        record,
        "SUCCEEDED",
        "HUMAN_REVIEW_REQUIRED",
        "PARTIALLY_PAID",
        SAFE.PARTIAL,
        ids.auditEntryId("final"),
        link,
      );
    if (link.status === "PAID")
      return this.#finish(
        command,
        "CANCEL_RECOVERY_ALREADY_PAID",
        record,
        "SUCCEEDED",
        "ALREADY_PAID_STOPPED",
        "ALREADY_PAID",
        SAFE.ALREADY_PAID,
        ids.auditEntryId("final"),
        link,
      );
    return this.#finish(
      command,
      "CANCEL_RECOVERY_ALREADY_PAID",
      record,
      "SUCCEEDED",
      "NO_OP_TERMINAL",
      link.status,
      SAFE.TERMINAL,
      ids.auditEntryId("final"),
      link,
    );
  }

  async #fetchPayment(
    command: RecoveryExecutionCommand,
    record: RecoveryActionRecord,
    ids: ReturnType<typeof executionIdentifiers>,
    stage: string,
  ): Promise<
    | { status: "AVAILABLE"; payment: AdapterPayment }
    | { status: "FAILED"; resultCode: string; explanation: string }
  > {
    if (
      !this.#appendAudit(
        command,
        ids.auditEntryId(`${stage}_started`),
        record.action,
        "ADAPTER_CALL_STARTED",
        "A current mock payment-state fetch started.",
        "FETCH_PAYMENT",
      )
    ) {
      return {
        status: "FAILED",
        resultCode: "AUDIT_INCOMPLETE",
        explanation: SAFE.AUDIT,
      };
    }
    const invocation = await this.#invoke(
      fetchPaymentResultSchema,
      command,
      (context) =>
        this.#adapter.fetchPayment(
          { paymentId: command.caseRecord.paymentId },
          context,
        ),
    );
    if (invocation.status !== "VALUE") {
      const resultCode =
        invocation.status === "TIMEOUT" ? "TIMEOUT" : "INVALID_RESPONSE";
      this.#appendAudit(
        command,
        ids.auditEntryId(`${stage}_failed`),
        record.action,
        "PRE_EXECUTION_STATE_CHECK_FAILED",
        "Current mock payment state could not be verified safely.",
        resultCode,
      );
      return {
        status: "FAILED",
        resultCode,
        explanation: SAFE.PAYMENT_UNAVAILABLE,
      };
    }
    if (invocation.value.status !== "AVAILABLE") {
      const resultCode = invocation.value.errorCode;
      this.#appendAudit(
        command,
        ids.auditEntryId(`${stage}_failed`),
        record.action,
        "PRE_EXECUTION_STATE_CHECK_FAILED",
        "Current mock payment state could not be verified safely.",
        resultCode,
      );
      return {
        status: "FAILED",
        resultCode,
        explanation: SAFE.PAYMENT_UNAVAILABLE,
      };
    }
    this.#appendAudit(
      command,
      ids.auditEntryId(`${stage}_succeeded`),
      record.action,
      "PRE_EXECUTION_STATE_CHECKED",
      "Current mock payment state was fetched for the safety precondition.",
      invocation.value.payment.status,
    );
    return { status: "AVAILABLE", payment: invocation.value.payment };
  }

  #validatePayment(command: RecoveryExecutionCommand, payment: AdapterPayment) {
    if (payment.paymentId !== command.caseRecord.paymentId)
      return "PAYMENT_ID_MISMATCH";
    if (payment.orderId !== command.caseRecord.orderId)
      return "ORDER_ID_MISMATCH";
    if (
      payment.amountSubunits !== command.caseRecord.verifiedUnpaidAmountSubunits
    )
      return "AMOUNT_MISMATCH";
    if (payment.currency !== command.caseRecord.currency)
      return "CURRENCY_MISMATCH";
    if (payment.status === "AUTHORIZED" || payment.status === "CAPTURED")
      return "ALREADY_PAID";
    if (payment.status !== "FAILED" && payment.status !== "CREATED")
      return "PAYMENT_STATE_UNSAFE";
    return "VALID";
  }

  #validateCurrentCase(command: RecoveryExecutionCommand) {
    const current = this.#repositories.recoveryCases.findById(
      command.caseRecord.caseId,
    );
    if (current === null) return "CASE_NOT_FOUND";
    if (
      current.version !== command.caseRecord.version ||
      current.state !== command.caseRecord.state
    ) {
      return "CASE_STATE_STALE";
    }
    if (
      current.state === "RECOVERED" ||
      current.state === "STOPPED" ||
      current.state === "ESCALATED" ||
      current.state === "ERROR_SAFE"
    ) {
      return "CASE_TERMINAL";
    }
    return "VALID";
  }

  #linkMatches(command: RecoveryExecutionCommand, link: PaymentLinkRecord) {
    return (
      link.caseId === command.caseRecord.caseId &&
      link.orderId === command.caseRecord.orderId &&
      link.amountSubunits === command.caseRecord.verifiedUnpaidAmountSubunits &&
      link.currency === command.caseRecord.currency
    );
  }

  #persistAdapterLink(
    command: RecoveryExecutionCommand,
    recoveryLinkId: string,
    rawLink: AdapterPaymentLink,
  ): PaymentLinkRecord | null {
    const link = adapterPaymentLinkSchema.parse(rawLink);
    const input: PaymentLinkRecord = {
      recoveryLinkId: recoveryLinkId as PaymentLinkRecord["recoveryLinkId"],
      externalLinkId: link.externalLinkId,
      caseId: command.caseRecord.caseId,
      orderId: command.caseRecord.orderId,
      referenceId: link.referenceId,
      amountSubunits: link.amountSubunits,
      currency: link.currency,
      status: link.status,
      blocksCreation:
        link.status === "CREATED" || link.status === "PARTIALLY_PAID",
      createdAt: link.createdAt,
      expiresAt: link.expiresAt,
      updatedAt: link.updatedAt,
    };
    const persisted = this.#repositories.paymentLinks.insert(input);
    if (persisted.status === "CREATED") return persisted.paymentLink;
    return this.#linkMatches(command, persisted.paymentLink) &&
      persisted.paymentLink.referenceId === link.referenceId
      ? persisted.paymentLink
      : null;
  }

  #synchronizeLocalLink(
    local: PaymentLinkRecord,
    adapter: AdapterPaymentLink,
    updatedAt: string,
  ) {
    const status = adapter.status;
    return (
      this.#repositories.paymentLinks.updateLifecycle({
        recoveryLinkId: local.recoveryLinkId,
        externalLinkId: adapter.externalLinkId,
        status,
        blocksCreation: status === "CREATED" || status === "PARTIALLY_PAID",
        expiresAt: adapter.expiresAt,
        paidAt: status === "PAID" ? updatedAt : undefined,
        cancelledAt: status === "CANCELLED" ? updatedAt : undefined,
        updatedAt,
      }) ?? local
    );
  }

  #existingResult(
    command: RecoveryExecutionCommand,
    action: RecoveryAction,
    record: RecoveryActionRecord,
    referenceId: string,
    finalAuditId: string,
  ) {
    if (record.status === "REQUESTED" || record.status === "STARTED")
      return this.#result(
        command,
        action,
        "IN_PROGRESS",
        "ACTION_IN_PROGRESS",
        SAFE.IN_PROGRESS,
        record,
      );
    const link =
      this.#repositories.paymentLinks.findByReferenceId(referenceId) ??
      undefined;
    if (record.status === "FAILED_SAFE")
      return this.#result(
        command,
        action,
        "FAILED_SAFE",
        record.safeResultCode ?? "FAILED_SAFE",
        record.safeErrorReason ?? SAFE.PAYMENT_UNAVAILABLE,
        record,
        link,
      );
    const status =
      record.status === "CANCELLED" ? "NO_OP_TERMINAL" : "IDEMPOTENT_REPLAY";
    const result = this.#result(
      command,
      action,
      status,
      record.safeResultCode ?? "IDEMPOTENT_REPLAY",
      SAFE.REPLAY,
      record,
      link,
    );
    return this.#appendAudit(
      command,
      finalAuditId,
      action,
      "EXECUTION_REPLAYED",
      "A persisted recovery-action result was returned without adapter repetition.",
      result.resultCode,
      link,
    )
      ? result
      : this.#result(
          command,
          action,
          "AUDIT_INCOMPLETE",
          "AUDIT_REPLAY_INCOMPLETE",
          SAFE.AUDIT,
          record,
          link,
        );
  }

  #finish(
    command: RecoveryExecutionCommand,
    action: RecoveryAction,
    previous: RecoveryActionRecord,
    persistedStatus: "SUCCEEDED" | "FAILED_SAFE" | "CANCELLED",
    resultStatus: Exclude<
      RecoveryExecutionResult["status"],
      "INVALID_INPUT" | "POLICY_REJECTED" | "IN_PROGRESS" | "IDEMPOTENT_REPLAY"
    >,
    resultCode: string,
    explanation: string,
    auditEntryId: string,
    paymentLink?: PaymentLinkRecord,
  ): RecoveryExecutionResult {
    const update = this.#repositories.recoveryActions.updateIfStatus({
      actionRecordId: previous.actionRecordId,
      expectedStatus: "STARTED",
      status: persistedStatus,
      attemptCount: previous.attemptCount,
      safeResultCode: resultCode,
      safeResultDetail: explanation,
      safeErrorReason:
        persistedStatus === "FAILED_SAFE" ? explanation : undefined,
      startedAt: previous.startedAt,
      completedAt: command.executedAt,
      updatedAt: command.executedAt,
    });
    const actionRecord = update.action ?? previous;
    if (update.status !== "UPDATED")
      return this.#result(
        command,
        action,
        "IN_PROGRESS",
        "ACTION_STATUS_CONFLICT",
        SAFE.IN_PROGRESS,
        actionRecord,
        paymentLink,
      );
    const eventType =
      persistedStatus === "FAILED_SAFE"
        ? "EXECUTION_FAILED_SAFE"
        : resultStatus === "HUMAN_REVIEW_REQUIRED"
          ? "HUMAN_ESCALATION_RECORDED"
          : "EXECUTION_COMPLETED";
    if (
      !this.#appendAudit(
        command,
        auditEntryId,
        action,
        eventType,
        "The bounded recovery executor recorded its final sanitized outcome.",
        resultCode,
        paymentLink,
      )
    ) {
      return this.#result(
        command,
        action,
        "AUDIT_INCOMPLETE",
        "AUDIT_FINAL_INCOMPLETE",
        SAFE.AUDIT,
        actionRecord,
        paymentLink,
      );
    }
    return this.#result(
      command,
      action,
      resultStatus,
      resultCode,
      explanation,
      actionRecord,
      paymentLink,
    );
  }

  #postCallAuditResult(
    command: RecoveryExecutionCommand,
    action: RecoveryAction,
    auditOkay: boolean,
    finished: RecoveryExecutionResult,
    paymentLink?: PaymentLinkRecord,
  ): RecoveryExecutionResult {
    if (auditOkay) return finished;
    return this.#result(
      command,
      action,
      "AUDIT_INCOMPLETE",
      "AUDIT_POST_CALL_INCOMPLETE",
      SAFE.AUDIT,
      "recoveryAction" in finished ? finished.recoveryAction : undefined,
      paymentLink,
    );
  }

  #appendAudit(
    command: RecoveryExecutionCommand,
    entryId: string,
    action: RecoveryAction,
    eventType: string,
    reason: string,
    providerStatus: string,
    link?: PaymentLinkRecord,
  ) {
    const result = this.#audit.append({
      entryId,
      timestamp: command.executedAt,
      actor: "RECOVERY_EXECUTOR",
      inputReference: command.caseRecord.caseId,
      eventType,
      reason,
      previousState: command.caseRecord.state,
      newState: command.caseRecord.state,
      metadata: {
        caseId: command.caseRecord.caseId,
        paymentId: command.caseRecord.paymentId,
        orderId: command.caseRecord.orderId,
        ...(link === undefined ? {} : { recoveryLinkId: link.recoveryLinkId }),
        action,
        providerStatus,
        isSynthetic: true,
      },
    });
    return (
      result.status === "APPENDED" || result.status === "IDEMPOTENT_REPLAY"
    );
  }

  async #invoke<T>(
    schema: z.ZodType<T>,
    command: RecoveryExecutionCommand,
    operation: (context: {
      requestedAt: string;
      timeoutMilliseconds: number;
      signal: AbortSignal;
    }) => Promise<unknown>,
  ): Promise<Invocation<T>> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const valuePromise = Promise.resolve()
      .then(() =>
        operation({
          requestedAt: command.executedAt,
          timeoutMilliseconds: command.timeoutMilliseconds,
          signal: controller.signal,
        }),
      )
      .then((value) => ({ status: "VALUE" as const, value }))
      .catch(() => ({ status: "INVALID_RESPONSE" as const }));
    const timeoutPromise = new Promise<{ status: "TIMEOUT" }>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ status: "TIMEOUT" });
      }, command.timeoutMilliseconds);
    });
    const invocation = await Promise.race([valuePromise, timeoutPromise]);
    if (timer !== undefined) clearTimeout(timer);
    if (invocation.status !== "VALUE") return invocation;
    const parsed = schema.safeParse(invocation.value);
    return parsed.success
      ? { status: "VALUE", value: parsed.data }
      : { status: "INVALID_RESPONSE" };
  }

  #result(
    command: RecoveryExecutionCommand,
    action: RecoveryAction,
    status: Exclude<RecoveryExecutionResult["status"], "INVALID_INPUT">,
    resultCode: string,
    explanation: string,
    recoveryAction?: RecoveryActionRecord,
    paymentLink?: PaymentLinkRecord,
  ): RecoveryExecutionResult {
    return recoveryExecutionResultSchema.parse({
      status,
      caseId: command.caseRecord.caseId,
      action,
      resultCode,
      explanation,
      recoveryAction,
      paymentLink,
    });
  }
}
