import { createHash } from "node:crypto";

import type { SqliteAuditChain } from "@/audit";
import type { PersistedWebhookEvent } from "@/repositories";
import type { VerifiedWebhookEventProcessor } from "@/webhooks/contracts";

function webhookAuditEntryId(providerEventId: string) {
  const digest = createHash("sha256")
    .update(`recoverai_webhook_audit_v1:${providerEventId}`)
    .digest("hex")
    .slice(0, 40);
  return `audit_webhook_${digest}`;
}

export class VerifiedWebhookAuditProcessor implements VerifiedWebhookEventProcessor {
  constructor(private readonly audit: SqliteAuditChain) {}

  process(event: PersistedWebhookEvent): void {
    const result = this.audit.append({
      entryId: webhookAuditEntryId(event.providerEventId),
      timestamp: event.event.receivedAt,
      actor: "WEBHOOK_INGESTOR",
      inputReference: event.providerEventId,
      eventType: "VERIFIED_WEBHOOK_ACCEPTED",
      reason:
        "A signature-verified provider event was accepted once for bounded downstream processing.",
      previousState: null,
      newState: null,
      metadata: {
        eventId: event.internalEventId,
        ...(event.event.paymentId === undefined
          ? {}
          : { paymentId: event.event.paymentId }),
        ...(event.event.orderId === undefined
          ? {}
          : { orderId: event.event.orderId }),
        ...(event.event.recoveryLinkId === undefined
          ? {}
          : { recoveryLinkId: event.event.recoveryLinkId }),
        providerStatus: event.event.eventName,
        isSynthetic: false,
      },
    });
    if (result.status !== "APPENDED" && result.status !== "IDEMPOTENT_REPLAY") {
      throw new Error("Verified webhook audit append failed safely.");
    }
  }
}
