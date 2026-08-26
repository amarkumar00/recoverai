import type { PaymentStateReconciler } from "@/reconciliation";
import type { PersistedWebhookEvent } from "@/repositories";
import { VerifiedWebhookAuditProcessor } from "@/webhooks/audit-processor";
import type { VerifiedWebhookEventProcessor } from "@/webhooks/contracts";

export class VerifiedWebhookReconciliationProcessor implements VerifiedWebhookEventProcessor {
  constructor(
    private readonly acceptanceAudit: VerifiedWebhookAuditProcessor,
    private readonly reconciler: PaymentStateReconciler,
    private readonly timeoutMilliseconds = 1_000,
    private readonly paymentLinkProcessor?: VerifiedWebhookEventProcessor,
  ) {}

  async process(event: PersistedWebhookEvent): Promise<void> {
    this.acceptanceAudit.process(event);
    await this.paymentLinkProcessor?.process(event);
    await this.reconciler.reconcile({
      event,
      checkedAt: event.event.receivedAt,
      timeoutMilliseconds: this.timeoutMilliseconds,
    });
  }
}
