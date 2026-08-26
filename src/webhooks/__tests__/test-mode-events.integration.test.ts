import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { createSqliteAuditChain } from "@/audit";
import { createLocalDatabase, type LocalDatabase } from "@/lib/db/client";
import { runDatabaseMigrations } from "@/lib/db/migrations";
import {
  paymentLinkRecordSchema,
  recoveryCaseRecordSchema,
} from "@/repositories/contracts";
import { createSqliteRepositories } from "@/repositories/sqlite";
import {
  SecureRazorpayWebhookIngestor,
  VerifiedPaymentLinkWebhookProcessor,
  VerifiedWebhookAuditProcessor,
  type VerifiedWebhookEventProcessor,
} from "@/webhooks";

const secret = "recoverai_test_mode_webhook_fixture_secret";
const receivedAt = "2026-08-26T10:05:00.000Z";
const databases: LocalDatabase[] = [];

function environment() {
  const database = createLocalDatabase(":memory:");
  databases.push(database);
  runDatabaseMigrations(database);
  const repositories = createSqliteRepositories(database);
  const audit = createSqliteAuditChain(database);
  const acceptance = new VerifiedWebhookAuditProcessor(audit);
  const links = new VerifiedPaymentLinkWebhookProcessor(repositories, audit);
  const processor: VerifiedWebhookEventProcessor = {
    async process(event) {
      acceptance.process(event);
      links.process(event);
    },
  };
  return {
    database,
    repositories,
    audit,
    ingestor: new SecureRazorpayWebhookIngestor({ repositories, processor }),
  };
}

function seedLink(env: ReturnType<typeof environment>, suffix: string) {
  env.repositories.recoveryCases.create(
    recoveryCaseRecordSchema.parse({
      caseId: `case_test_${suffix}`,
      paymentId: `pay_test_${suffix}`,
      orderId: `order_test_${suffix}`,
      syntheticCustomerHash: "a".repeat(64),
      verifiedUnpaidAmountSubunits: 12_500,
      currency: "INR",
      state: "LINK_CREATED",
      attemptNumber: 1,
      previousSuccessCount: 0,
      previousFailureCount: 1,
      contactCount: 0,
      recoveryWindowStartsAt: "2026-08-26T10:00:00.000Z",
      recoveryWindowEndsAt: "2026-08-27T10:00:00.000Z",
      version: 1,
      createdAt: "2026-08-26T10:00:00.000Z",
      updatedAt: "2026-08-26T10:00:00.000Z",
    }),
  );
  env.repositories.paymentLinks.insert(
    paymentLinkRecordSchema.parse({
      recoveryLinkId: `link_test_${suffix}`,
      externalLinkId: `plink_test_${suffix}`,
      caseId: `case_test_${suffix}`,
      orderId: `order_test_${suffix}`,
      referenceId: `reference_test_${suffix}`,
      amountSubunits: 12_500,
      currency: "INR",
      status: "CREATED",
      blocksCreation: true,
      createdAt: "2026-08-26T10:00:00.000Z",
      expiresAt: "2026-08-26T11:00:00.000Z",
      updatedAt: "2026-08-26T10:00:00.000Z",
    }),
  );
}

function paymentLinkEnvelope(
  suffix: string,
  event: "payment_link.paid" | "payment_link.partially_paid",
  amountPaid: number,
) {
  return {
    entity: "event",
    event,
    contains: ["payment_link"],
    payload: {
      payment_link: {
        entity: {
          id: `plink_test_${suffix}`,
          amount: 12_500,
          amount_paid: amountPaid,
          currency: "INR",
          status: event === "payment_link.paid" ? "paid" : "partially_paid",
          reference_id: `reference_test_${suffix}`,
        },
      },
    },
    created_at: 1_787_741_100,
  };
}

async function ingest(
  env: ReturnType<typeof environment>,
  payload: unknown,
  eventId: string,
) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  return env.ingestor.ingest({
    rawBody,
    signature: createHmac("sha256", secret).update(rawBody).digest("hex"),
    providerEventId: eventId,
    webhookSecret: secret,
    receivedAt,
  });
}

afterEach(() => {
  for (const database of databases.splice(0)) database.client.close();
});

describe("signature-verified Test Mode webhook processing", () => {
  it("recovers a known fully-paid link once and deduplicates replay", async () => {
    const env = environment();
    seedLink(env, "paid001");
    const payload = paymentLinkEnvelope("paid001", "payment_link.paid", 12_500);
    expect(await ingest(env, payload, "event_link_paid001")).toMatchObject({
      status: "ACCEPTED",
    });
    expect(await ingest(env, payload, "event_link_paid001")).toMatchObject({
      status: "DUPLICATE",
    });
    expect(
      env.repositories.recoveryCases.findById("case_test_paid001"),
    ).toMatchObject({
      state: "RECOVERED",
      version: 2,
    });
    expect(
      env.repositories.paymentLinks.findByExternalLinkId("plink_test_paid001"),
    ).toMatchObject({
      status: "PAID",
      blocksCreation: false,
    });
  });

  it("concurrent duplicate paid deliveries converge on one transition", async () => {
    const env = environment();
    seedLink(env, "concurrent001");
    const payload = paymentLinkEnvelope(
      "concurrent001",
      "payment_link.paid",
      12_500,
    );
    const results = await Promise.all([
      ingest(env, payload, "event_link_concurrent001"),
      ingest(env, payload, "event_link_concurrent001"),
    ]);
    expect(results.map(({ status }) => status).sort()).toEqual([
      "ACCEPTED",
      "DUPLICATE",
    ]);
    expect(
      env.repositories.recoveryCases.findById("case_test_concurrent001"),
    ).toMatchObject({ state: "RECOVERED", version: 2 });
  });

  it("escalates a valid partial payment and never cancels or duplicates collection", async () => {
    const env = environment();
    seedLink(env, "partial001");
    expect(
      await ingest(
        env,
        paymentLinkEnvelope("partial001", "payment_link.partially_paid", 5_000),
        "event_link_partial001",
      ),
    ).toMatchObject({ status: "ACCEPTED" });
    expect(
      env.repositories.recoveryCases.findById("case_test_partial001"),
    ).toMatchObject({
      state: "ESCALATED",
    });
    expect(
      env.repositories.paymentLinks.findByExternalLinkId(
        "plink_test_partial001",
      ),
    ).toMatchObject({
      status: "PARTIALLY_PAID",
      blocksCreation: true,
      cancelledAt: undefined,
    });
  });

  it("rejects conflicting money without changing the case", async () => {
    const env = environment();
    seedLink(env, "conflict001");
    const payload = paymentLinkEnvelope(
      "conflict001",
      "payment_link.paid",
      12_500,
    );
    payload.payload.payment_link.entity.amount = 99_999;
    expect(await ingest(env, payload, "event_link_conflict001")).toMatchObject({
      status: "ACCEPTED",
    });
    expect(
      env.repositories.recoveryCases.findById("case_test_conflict001"),
    ).toMatchObject({
      state: "LINK_CREATED",
      version: 1,
    });
  });

  it("safely ignores a valid unknown event without persistence or audit effects", async () => {
    const env = environment();
    const unknown = {
      ...paymentLinkEnvelope("unknown001", "payment_link.paid", 12_500),
      event: "refund.created",
    };
    expect(await ingest(env, unknown, "event_unknown001")).toEqual({
      status: "IGNORED_UNSUPPORTED",
    });
    expect(
      env.repositories.webhookEvents.findByProviderEventId("event_unknown001"),
    ).toBeNull();
    expect(env.audit.readOrdered()).toHaveLength(0);
  });

  it("accepts and deduplicates a strictly validated downtime context event", async () => {
    const env = environment();
    const payload = {
      entity: "event",
      event: "payment.downtime.started",
      contains: ["payment_downtime"],
      payload: {
        payment_downtime: {
          entity: {
            id: "down_test001",
            entity: "payment.downtime",
            method: "upi",
            status: "started",
            begin: 1_787_741_000,
          },
        },
      },
      created_at: 1_787_741_000,
    };
    expect(await ingest(env, payload, "event_down001")).toMatchObject({
      status: "ACCEPTED",
    });
    expect(await ingest(env, payload, "event_down001")).toMatchObject({
      status: "DUPLICATE",
    });
  });
});
