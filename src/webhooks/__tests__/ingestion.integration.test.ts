import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { validExternalWebhook } from "@/domain/__tests__/fixtures";
import { createSqliteAuditChain } from "@/audit";
import { createLocalDatabase } from "@/lib/db/client";
import { runDatabaseMigrations } from "@/lib/db/migrations";
import { createSqliteRepositories } from "@/repositories";
import {
  SecureRazorpayWebhookIngestor,
  VerifiedWebhookAuditProcessor,
  type VerifiedWebhookEventProcessor,
} from "@/webhooks";
import {
  providerEventId,
  rawWebhookBody,
  receivedAt,
  signRawBody,
  webhookSecret,
} from "@/webhooks/__tests__/fixtures";

const directories: string[] = [];

function setup(processor?: VerifiedWebhookEventProcessor) {
  const directory = mkdtempSync(join(tmpdir(), "recoverai-webhook-"));
  directories.push(directory);
  const database = createLocalDatabase(join(directory, "webhook.db"));
  runDatabaseMigrations(database);
  const repositories = createSqliteRepositories(database);
  const audit = createSqliteAuditChain(database);
  return {
    database,
    repositories,
    audit,
    ingestor: new SecureRazorpayWebhookIngestor({
      repositories,
      processor: processor ?? new VerifiedWebhookAuditProcessor(audit),
    }),
  };
}

function ingest(
  ingestor: SecureRazorpayWebhookIngestor,
  overrides: Partial<
    Parameters<SecureRazorpayWebhookIngestor["ingest"]>[0]
  > = {},
) {
  const rawBody = overrides.rawBody ?? rawWebhookBody();
  return ingestor.ingest({
    rawBody,
    signature: signRawBody(rawBody),
    providerEventId,
    webhookSecret,
    receivedAt,
    ...overrides,
  });
}

function materialCounts(database: ReturnType<typeof createLocalDatabase>) {
  const count = (table: string) =>
    (
      database.client
        .prepare(`SELECT count(*) AS count FROM ${table}`)
        .get() as {
        count: number;
      }
    ).count;
  return {
    events: count("webhook_events"),
    cases: count("recovery_cases"),
    actions: count("recovery_actions"),
    links: count("payment_links"),
    audits: count("audit_entries"),
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("secure webhook ingestion", () => {
  it("accepts, normalizes, persists, and audits the first valid delivery", async () => {
    const environment = setup();
    try {
      const result = await ingest(environment.ingestor);
      expect(result).toMatchObject({
        status: "ACCEPTED",
        event: {
          providerEventId,
          payloadDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          event: {
            eventId: providerEventId,
            eventName: "payment.failed",
            paymentId: "pay_demo_001",
            orderId: "order_demo_001",
            signatureVerification: { status: "VERIFIED" },
            duplicateProcessing: { status: "FIRST_SEEN" },
          },
        },
      });
      expect(materialCounts(environment.database)).toEqual({
        events: 1,
        cases: 0,
        actions: 0,
        links: 0,
        audits: 1,
      });
      expect(environment.audit.verify()).toMatchObject({
        status: "VALID",
        checkpoint: { entryCount: 1 },
      });
    } finally {
      environment.database.client.close();
    }
  });

  it.each([
    ["missing signature", { signature: null }, "MISSING_SIGNATURE"],
    ["malformed signature", { signature: "not-hex" }, "MALFORMED_SIGNATURE"],
    ["invalid signature", { signature: "0".repeat(64) }, "INVALID_SIGNATURE"],
    ["missing event ID", { providerEventId: null }, "MISSING_EVENT_ID"],
    [
      "malformed event ID",
      { providerEventId: "bad event id" },
      "MALFORMED_EVENT_ID",
    ],
  ])(
    "rejects %s before persistence or downstream effects",
    async (_label, overrides, reason) => {
      const processor = {
        calls: 0,
        process() {
          this.calls += 1;
        },
      };
      const environment = setup(processor);
      try {
        expect(await ingest(environment.ingestor, overrides)).toEqual({
          status: "REJECTED",
          reason,
        });
        expect(processor.calls).toBe(0);
        expect(materialCounts(environment.database)).toEqual({
          events: 0,
          cases: 0,
          actions: 0,
          links: 0,
          audits: 0,
        });
      } finally {
        environment.database.client.close();
      }
    },
  );

  it("rejects invalid JSON even when its exact raw bytes have a valid signature", async () => {
    const environment = setup();
    const rawBody = Buffer.from("{invalid-json", "utf8");
    try {
      expect(await ingest(environment.ingestor, { rawBody })).toEqual({
        status: "REJECTED",
        reason: "INVALID_JSON",
      });
      expect(materialCounts(environment.database).events).toBe(0);
      expect(materialCounts(environment.database).audits).toBe(0);
    } finally {
      environment.database.client.close();
    }
  });

  it("rejects a signed payload that fails the strict external-event boundary", async () => {
    const environment = setup();
    const invalid = structuredClone(validExternalWebhook);
    invalid.payload.payment.entity.amount = -1;
    const rawBody = rawWebhookBody(invalid);
    try {
      expect(await ingest(environment.ingestor, { rawBody })).toEqual({
        status: "REJECTED",
        reason: "INVALID_PAYLOAD",
      });
      expect(materialCounts(environment.database).events).toBe(0);
      expect(materialCounts(environment.database).audits).toBe(0);
    } finally {
      environment.database.client.close();
    }
  });

  it("ignores an identical sequential duplicate without another material effect", async () => {
    const processor = {
      calls: 0,
      caseCreations: 0,
      recoveryRuns: 0,
      recoveryActions: 0,
      paymentLinks: 0,
      auditEffects: 0,
      process() {
        this.calls += 1;
        this.caseCreations += 1;
        this.recoveryRuns += 1;
        this.recoveryActions += 1;
        this.paymentLinks += 1;
        this.auditEffects += 1;
      },
    };
    const environment = setup(processor);
    try {
      expect((await ingest(environment.ingestor)).status).toBe("ACCEPTED");
      expect(
        (
          await ingest(environment.ingestor, {
            receivedAt: "2026-08-26T09:00:05.000Z",
          })
        ).status,
      ).toBe("DUPLICATE");
      expect(processor).toMatchObject({
        calls: 1,
        caseCreations: 1,
        recoveryRuns: 1,
        recoveryActions: 1,
        paymentLinks: 1,
        auditEffects: 1,
      });
      expect(materialCounts(environment.database).events).toBe(1);
    } finally {
      environment.database.client.close();
    }
  });

  it("deduplicates an identical minimal payment payload with absent optional fields", async () => {
    const environment = setup();
    const omittedKeys = new Set([
      "bank",
      "wallet",
      "error_description",
      "error_source",
      "error_step",
    ]);
    const minimalEntity = Object.fromEntries(
      Object.entries(validExternalWebhook.payload.payment.entity).filter(
        ([key]) => !omittedKeys.has(key),
      ),
    );
    const minimal = {
      ...validExternalWebhook,
      payload: { payment: { entity: minimalEntity } },
    };
    const rawBody = rawWebhookBody(minimal);
    try {
      expect((await ingest(environment.ingestor, { rawBody })).status).toBe(
        "ACCEPTED",
      );
      expect(
        (
          await ingest(environment.ingestor, {
            rawBody,
            receivedAt: "2026-08-26T09:00:09.000Z",
          })
        ).status,
      ).toBe("DUPLICATE");
      expect(materialCounts(environment.database).events).toBe(1);
      expect(materialCounts(environment.database).audits).toBe(1);
    } finally {
      environment.database.client.close();
    }
  });

  it("fails closed when one provider event ID is reused with conflicting content", async () => {
    const processor = {
      calls: 0,
      process() {
        this.calls += 1;
      },
    };
    const environment = setup(processor);
    const conflicting = structuredClone(validExternalWebhook);
    conflicting.payload.payment.entity.amount = 999_999;
    const conflictingBody = rawWebhookBody(conflicting);
    try {
      expect((await ingest(environment.ingestor)).status).toBe("ACCEPTED");
      expect(
        (
          await ingest(environment.ingestor, {
            rawBody: conflictingBody,
            signature: signRawBody(conflictingBody),
          })
        ).status,
      ).toBe("CONFLICT");
      expect(processor.calls).toBe(1);
      expect(materialCounts(environment.database).events).toBe(1);
    } finally {
      environment.database.client.close();
    }
  });

  it("allows only one downstream gate while concurrent duplicate requests overlap", async () => {
    let release!: () => void;
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => {
      started = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const processor = {
      calls: 0,
      async process() {
        this.calls += 1;
        started();
        await hold;
      },
    };
    const environment = setup(processor);
    try {
      const first = ingest(environment.ingestor);
      await didStart;
      const second = ingest(environment.ingestor, {
        receivedAt: "2026-08-26T09:00:01.000Z",
      });
      release();
      const outcomes = await Promise.all([first, second]);
      expect(outcomes.map(({ status }) => status).sort()).toEqual([
        "ACCEPTED",
        "DUPLICATE",
      ]);
      expect(processor.calls).toBe(1);
      expect(materialCounts(environment.database).events).toBe(1);
    } finally {
      environment.database.client.close();
    }
  });

  it("does not automatically replay downstream processing after a first-seen interruption", async () => {
    const processor = {
      calls: 0,
      process() {
        this.calls += 1;
        throw new Error("injected downstream interruption");
      },
    };
    const environment = setup(processor);
    try {
      expect(await ingest(environment.ingestor)).toEqual({
        status: "FAILED_SAFE",
      });
      expect(
        await ingest(environment.ingestor, {
          receivedAt: "2026-08-26T09:00:02.000Z",
        }),
      ).toMatchObject({ status: "DUPLICATE" });
      expect(processor.calls).toBe(1);
      expect(materialCounts(environment.database)).toEqual({
        events: 1,
        cases: 0,
        actions: 0,
        links: 0,
        audits: 0,
      });
    } finally {
      environment.database.client.close();
    }
  });
});
