import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createSqliteAuditChain } from "@/audit";
import { validExternalWebhook } from "@/domain/__tests__/fixtures";
import { createLocalDatabase } from "@/lib/db/client";
import { runDatabaseMigrations } from "@/lib/db/migrations";
import { createSqliteRepositories } from "@/repositories";
import {
  handleRazorpayWebhookRequest,
  SecureRazorpayWebhookIngestor,
  VerifiedWebhookAuditProcessor,
} from "@/webhooks";
import {
  providerEventId,
  rawWebhookBody,
  signRawBody,
  signedHeaders,
  webhookSecret,
} from "@/webhooks/__tests__/fixtures";

const directories: string[] = [];

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "recoverai-webhook-http-"));
  directories.push(directory);
  const database = createLocalDatabase(join(directory, "http.db"));
  runDatabaseMigrations(database);
  const repositories = createSqliteRepositories(database);
  const ingestor = new SecureRazorpayWebhookIngestor({
    repositories,
    processor: new VerifiedWebhookAuditProcessor(
      createSqliteAuditChain(database),
    ),
  });
  return { database, ingestor };
}

function materialCounts(database: ReturnType<typeof createLocalDatabase>) {
  const count = (table: string) =>
    (
      database.client
        .prepare(`SELECT count(*) AS count FROM ${table}`)
        .get() as { count: number }
    ).count;
  return {
    events: count("webhook_events"),
    cases: count("recovery_cases"),
    actions: count("recovery_actions"),
    links: count("payment_links"),
    audits: count("audit_entries"),
  };
}

function request(
  rawBody: Uint8Array,
  headers: HeadersInit = signedHeaders(rawBody),
) {
  return new Request("http://localhost/api/webhooks/razorpay", {
    method: "POST",
    headers,
    body: Buffer.from(rawBody),
  });
}

async function post(
  ingestor: SecureRazorpayWebhookIngestor,
  rawBody: Uint8Array,
  headers?: HeadersInit,
  secret: string | undefined = webhookSecret,
) {
  return handleRazorpayWebhookRequest(request(rawBody, headers), {
    webhookSecret: secret,
    getIngestor: () => ingestor,
    now: () => new Date("2026-08-26T09:00:00.000Z"),
  });
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Razorpay webhook HTTP boundary", () => {
  it("returns deterministic success for first and duplicate valid deliveries", async () => {
    const environment = setup();
    const rawBody = rawWebhookBody();
    try {
      const first = await post(environment.ingestor, rawBody);
      expect(first.status).toBe(202);
      expect(await first.json()).toEqual({
        status: "ACCEPTED",
        resultCode: "EVENT_ACCEPTED",
      });
      const duplicate = await post(environment.ingestor, rawBody);
      expect(duplicate.status).toBe(200);
      expect(await duplicate.json()).toEqual({
        status: "ACCEPTED",
        resultCode: "DUPLICATE_IGNORED",
      });
    } finally {
      environment.database.client.close();
    }
  });

  it("rejects a differently serialized body signed for the original bytes", async () => {
    const environment = setup();
    const compact = rawWebhookBody();
    const pretty = rawWebhookBody(undefined, 2);
    try {
      const response = await post(environment.ingestor, pretty, {
        "x-razorpay-event-id": providerEventId,
        "x-razorpay-signature": signRawBody(compact),
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        status: "ERROR_SAFE",
        resultCode: "SIGNATURE_REJECTED",
      });
    } finally {
      environment.database.client.close();
    }
  });

  it("returns the same safe signature response for missing, malformed, and invalid signatures", async () => {
    const environment = setup();
    const rawBody = rawWebhookBody();
    try {
      for (const signature of [null, "not-hex", "0".repeat(64)]) {
        const headers = new Headers({
          "x-razorpay-event-id": providerEventId,
        });
        if (signature !== null) headers.set("x-razorpay-signature", signature);
        const response = await post(environment.ingestor, rawBody, headers);
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({
          status: "ERROR_SAFE",
          resultCode: "SIGNATURE_REJECTED",
        });
      }
    } finally {
      environment.database.client.close();
    }
  });

  it("rejects declared and actual oversized bodies before ingestion", async () => {
    const environment = setup();
    let runtimeLoads = 0;
    const oversized = Buffer.alloc(256 * 1_024 + 1, "x");
    try {
      const declared = await handleRazorpayWebhookRequest(
        request(rawWebhookBody(), {
          ...Object.fromEntries(new Headers(signedHeaders(rawWebhookBody()))),
          "content-length": String(oversized.byteLength),
        }),
        {
          webhookSecret,
          getIngestor: () => {
            runtimeLoads += 1;
            return environment.ingestor;
          },
        },
      );
      const actual = await handleRazorpayWebhookRequest(
        request(oversized, signedHeaders(oversized)),
        {
          webhookSecret,
          getIngestor: () => {
            runtimeLoads += 1;
            return environment.ingestor;
          },
        },
      );

      for (const response of [declared, actual]) {
        expect(response.status).toBe(413);
        expect(await response.json()).toEqual({
          status: "ERROR_SAFE",
          resultCode: "PAYLOAD_TOO_LARGE",
        });
      }
      expect(runtimeLoads).toBe(0);
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
  });

  it("rejects validly signed invalid JSON and schema-invalid JSON safely", async () => {
    const environment = setup();
    const invalidJson = Buffer.from("{invalid", "utf8");
    const invalidPayload = structuredClone(validExternalWebhook);
    invalidPayload.payload.payment.entity.currency = "inr";
    const schemaInvalid = rawWebhookBody(invalidPayload);
    try {
      for (const body of [invalidJson, schemaInvalid]) {
        const response = await post(environment.ingestor, body);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          status: "ERROR_SAFE",
          resultCode: "PAYLOAD_REJECTED",
        });
      }
    } finally {
      environment.database.client.close();
    }
  });

  it("returns a safe conflict response for changed content under one event ID", async () => {
    const environment = setup();
    const original = rawWebhookBody();
    const changedPayload = structuredClone(validExternalWebhook);
    changedPayload.payload.payment.entity.error_reason = "insufficient_funds";
    const changed = rawWebhookBody(changedPayload);
    try {
      expect((await post(environment.ingestor, original)).status).toBe(202);
      const conflict = await post(environment.ingestor, changed);
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toEqual({
        status: "ERROR_SAFE",
        resultCode: "EVENT_ID_CONFLICT",
      });
    } finally {
      environment.database.client.close();
    }
  });

  it("does not initialize ingestion when the optional webhook secret is absent", async () => {
    const environment = setup();
    let runtimeLoads = 0;
    try {
      const response = await handleRazorpayWebhookRequest(
        request(rawWebhookBody()),
        {
          webhookSecret: undefined,
          getIngestor: () => {
            runtimeLoads += 1;
            return environment.ingestor;
          },
        },
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        status: "ERROR_SAFE",
        resultCode: "WEBHOOK_NOT_CONFIGURED",
      });
      expect(runtimeLoads).toBe(0);
    } finally {
      environment.database.client.close();
    }
  });

  it("never exposes secret, payload, PII, stack, or database details in errors", async () => {
    const environment = setup();
    const sensitiveBody = Buffer.from(
      JSON.stringify({
        email: "customer@example.com",
        phone: "+919876543210",
        webhookSecret,
        database: "/private/recoverai.db",
      }),
      "utf8",
    );
    try {
      const response = await post(environment.ingestor, sensitiveBody);
      const responseText = await response.text();
      expect(response.status).toBe(400);
      expect(responseText).not.toMatch(
        /customer@example|9876543210|recoverai_test_webhook_secret|private\/recoverai|stack trace|raw payload/i,
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    } finally {
      environment.database.client.close();
    }
  });
});
