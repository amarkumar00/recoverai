import { createHash } from "node:crypto";

import type { SqliteAuditChain } from "@/audit";
import { transitionRecoveryCase } from "@/recovery/transition-service";
import type { PersistedWebhookEvent, RecoveryCaseRecord } from "@/repositories";
import type { RecoverAiRepositories } from "@/repositories/interfaces";
import type { VerifiedWebhookEventProcessor } from "@/webhooks/contracts";

function auditId(eventId: string, stage: string) {
  return `audit_link_${createHash("sha256")
    .update(`recoverai_test_link_webhook_v1:${eventId}:${stage}`)
    .digest("hex")
    .slice(0, 40)}`;
}

export class VerifiedPaymentLinkWebhookProcessor implements VerifiedWebhookEventProcessor {
  constructor(
    private readonly repositories: RecoverAiRepositories,
    private readonly audit: SqliteAuditChain,
  ) {}

  process(event: PersistedWebhookEvent): void {
    const snapshot = event.event.paymentLinkSnapshot;
    if (snapshot === undefined) return;

    const local = this.repositories.paymentLinks.findByExternalLinkId(
      snapshot.externalLinkId,
    );
    if (local === null || !snapshot.externalLinkId.startsWith("plink_")) return;
    const recoveryCase = this.repositories.recoveryCases.findById(local.caseId);
    if (recoveryCase === null) return;
    if (
      snapshot.referenceId !== local.referenceId ||
      snapshot.amountSubunits !== local.amountSubunits ||
      snapshot.currency !== local.currency ||
      snapshot.amountPaidSubunits > snapshot.amountSubunits
    ) {
      this.#audit(
        event,
        local.recoveryLinkId,
        local.caseId,
        recoveryCase.state,
        null,
        "PAYMENT_LINK_WEBHOOK_REJECTED",
        "A Test Mode Payment Link webhook conflicted with trusted local identity or money values.",
      );
      return;
    }
    if (["PAID", "CANCELLED", "EXPIRED"].includes(local.status)) return;

    if (snapshot.status === "PAID") {
      if (
        snapshot.amountPaidSubunits !== snapshot.amountSubunits ||
        snapshot.amountSubunits === 0
      )
        return;
      this.#audit(
        event,
        local.recoveryLinkId,
        local.caseId,
        recoveryCase.state,
        "RECOVERED",
        "PAYMENT_LINK_PAID_VERIFIED",
        "A known Test Mode Payment Link was fully paid with trusted identity and money values.",
      );
      this.repositories.paymentLinks.updateLifecycle({
        recoveryLinkId: local.recoveryLinkId,
        externalLinkId: local.externalLinkId,
        status: "PAID",
        blocksCreation: false,
        expiresAt: local.expiresAt,
        paidAt: event.event.occurredAt,
        updatedAt: event.event.receivedAt,
      });
      this.#transition(recoveryCase, "RECOVERED", {
        status: "SATISFIED",
        basis: "RECOVERY_LINK_PAID",
        verifiedAt: event.event.receivedAt,
      });
      return;
    }

    if (snapshot.status === "PARTIALLY_PAID") {
      if (
        snapshot.amountPaidSubunits <= 0 ||
        snapshot.amountPaidSubunits >= snapshot.amountSubunits
      )
        return;
      this.#audit(
        event,
        local.recoveryLinkId,
        local.caseId,
        recoveryCase.state,
        "ESCALATED",
        "PAYMENT_LINK_PARTIAL_REVIEW",
        "A known Test Mode Payment Link was partially paid; automated recovery stopped for human review.",
      );
      this.repositories.paymentLinks.updateLifecycle({
        recoveryLinkId: local.recoveryLinkId,
        externalLinkId: local.externalLinkId,
        status: "PARTIALLY_PAID",
        blocksCreation: true,
        expiresAt: local.expiresAt,
        updatedAt: event.event.receivedAt,
      });
      this.#transition(recoveryCase, "ESCALATED", {
        status: "CONFLICTING",
        reason:
          "Partial Test Mode Payment Link collection requires human review.",
        checkedAt: event.event.receivedAt,
      });
      return;
    }

    this.#audit(
      event,
      local.recoveryLinkId,
      local.caseId,
      recoveryCase.state,
      "ESCALATED",
      "PAYMENT_LINK_TERMINAL_REVIEW",
      "The known Test Mode Payment Link became unavailable; automated recovery stopped for review.",
    );
    this.repositories.paymentLinks.updateLifecycle({
      recoveryLinkId: local.recoveryLinkId,
      externalLinkId: local.externalLinkId,
      status: snapshot.status,
      blocksCreation: false,
      expiresAt: local.expiresAt,
      cancelledAt:
        snapshot.status === "CANCELLED" ? event.event.occurredAt : undefined,
      updatedAt: event.event.receivedAt,
    });
    this.#transition(recoveryCase, "ESCALATED", {
      status: "UNAVAILABLE",
      reason: "The Test Mode Payment Link is cancelled or expired.",
      checkedAt: event.event.receivedAt,
    });
  }

  #transition(
    recoveryCase: RecoveryCaseRecord,
    requestedState: "RECOVERED" | "ESCALATED",
    paymentSatisfaction: Parameters<
      typeof transitionRecoveryCase
    >[1]["paymentSatisfaction"],
  ) {
    transitionRecoveryCase(this.repositories.recoveryCases, {
      caseId: recoveryCase.caseId,
      expectedCurrentState: recoveryCase.state,
      requestedState,
      expectedVersion: recoveryCase.version,
      paymentSatisfaction,
      reasonCode:
        requestedState === "RECOVERED"
          ? "RECOVERY_LINK_PAID"
          : "RECOVERY_LINK_REVIEW_REQUIRED",
      reason:
        requestedState === "RECOVERED"
          ? "Trusted Test Mode Payment Link payment satisfied the recovery case."
          : "Test Mode Payment Link state requires human review.",
      transitionedAt:
        paymentSatisfaction.status === "SATISFIED"
          ? paymentSatisfaction.verifiedAt
          : paymentSatisfaction.status === "UNSATISFIED"
            ? paymentSatisfaction.verifiedAt
            : paymentSatisfaction.checkedAt,
    });
  }

  #audit(
    event: PersistedWebhookEvent,
    recoveryLinkId: string,
    caseId: string,
    previousState: RecoveryCaseRecord["state"],
    newState: RecoveryCaseRecord["state"] | null,
    eventType: string,
    reason: string,
  ) {
    const result = this.audit.append({
      entryId: auditId(event.providerEventId, eventType),
      timestamp: event.event.receivedAt,
      actor: "STATE_RECONCILER",
      inputReference: event.providerEventId,
      eventType,
      reason,
      previousState,
      newState,
      metadata: {
        caseId,
        recoveryLinkId,
        providerStatus: event.event.eventName,
        isSynthetic: false,
      },
    });
    if (result.status !== "APPENDED" && result.status !== "IDEMPOTENT_REPLAY") {
      throw new Error("Test Mode Payment Link audit failed safely.");
    }
  }
}
