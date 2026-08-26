import { afterEach, describe, expect, it } from "vitest";

import { DeterministicMockRazorpayAdapter } from "@/adapters/razorpay";
import { createSqliteAuditChain } from "@/audit";
import { validExternalWebhook } from "@/domain/__tests__/fixtures";
import { createLocalDatabase } from "@/lib/db/client";
import { runDatabaseMigrations } from "@/lib/db/migrations";
import { PaymentStateReconciler } from "@/reconciliation";
import { createSqliteRepositories } from "@/repositories";
import {
  SecureRazorpayWebhookIngestor,
  VerifiedWebhookAuditProcessor,
  VerifiedWebhookReconciliationProcessor,
} from "@/webhooks";
import {
  providerEventId,
  rawWebhookBody,
  receivedAt,
  signRawBody,
  webhookSecret,
} from "@/webhooks/__tests__/fixtures";

const databases: ReturnType<typeof createLocalDatabase>[] = [];

function setup() {
  const database = createLocalDatabase(":memory:");
  databases.push(database);
  runDatabaseMigrations(database);
  const repositories = createSqliteRepositories(database);
  const audit = createSqliteAuditChain(database);
  const adapter = new DeterministicMockRazorpayAdapter({
    payments: [
      {
        paymentId: "pay_demo_001",
        orderId: "order_demo_001",
        amountSubunits: 125_000,
        currency: "INR",
        status: "FAILED",
        fetchedAt: receivedAt,
      },
    ],
  });
  const reconciler = new PaymentStateReconciler({
    adapter,
    repositories,
    audit,
  });
  const ingestor = new SecureRazorpayWebhookIngestor({
    repositories,
    processor: new VerifiedWebhookReconciliationProcessor(
      new VerifiedWebhookAuditProcessor(audit),
      reconciler,
    ),
  });
  return { database, repositories, audit, adapter, ingestor };
}

function ingest(
  ingestor: SecureRazorpayWebhookIngestor,
  options: { rawBody?: Uint8Array; signature?: string | null } = {},
) {
  const body = options.rawBody ?? rawWebhookBody();
  return ingestor.ingest({
    rawBody: body,
    signature: options.signature ?? signRawBody(body),
    providerEventId,
    webhookSecret,
    receivedAt,
  });
}

afterEach(() => {
  for (const database of databases.splice(0)) database.client.close();
});

describe("verified public webhook reconciliation handoff", () => {
  it("hands only the verified first-seen event to current-state reconciliation", async () => {
    const env = setup();
    await expect(ingest(env.ingestor)).resolves.toMatchObject({
      status: "ACCEPTED",
    });
    await expect(ingest(env.ingestor)).resolves.toMatchObject({
      status: "DUPLICATE",
    });
    expect(
      env.adapter
        .getCallLog()
        .filter(({ operation }) => operation === "FETCH_PAYMENT"),
    ).toHaveLength(1);
    expect(
      env.repositories.paymentSnapshots.listByPaymentId("pay_demo_001"),
    ).toMatchObject([
      { origin: "WEBHOOK_EVIDENCE", snapshot: { status: "FAILED" } },
      { origin: "PROVIDER_RECONCILED", snapshot: { status: "FAILED" } },
    ]);
  });

  it("allows neither invalid signatures nor event-ID conflicts to repeat reconciliation", async () => {
    const env = setup();
    await expect(
      ingest(env.ingestor, { signature: "0".repeat(64) }),
    ).resolves.toMatchObject({ status: "REJECTED" });
    expect(env.adapter.getCallLog()).toHaveLength(0);

    await ingest(env.ingestor);
    const conflicting = structuredClone(validExternalWebhook);
    conflicting.payload.payment.entity.error_reason = "different_reason";
    const body = rawWebhookBody(conflicting);
    await expect(ingest(env.ingestor, { rawBody: body })).resolves.toEqual({
      status: "CONFLICT",
    });
    expect(
      env.adapter
        .getCallLog()
        .filter(({ operation }) => operation === "FETCH_PAYMENT"),
    ).toHaveLength(1);
    expect(env.audit.verify()).toMatchObject({ status: "VALID" });
  });
});
