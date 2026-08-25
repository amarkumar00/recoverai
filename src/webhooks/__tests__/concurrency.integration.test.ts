import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createLocalDatabase } from "@/lib/db/client";
import { runDatabaseMigrations } from "@/lib/db/migrations";
import {
  providerEventId,
  rawWebhookBody,
  receivedAt,
  signRawBody,
  webhookSecret,
} from "@/webhooks/__tests__/fixtures";

const directories: string[] = [];

function runWorker(input: {
  databasePath: string;
  rawBodyBase64: string;
  signature: string;
  startAt: number;
}) {
  return new Promise<{ status: string }>((resolveWorker, rejectWorker) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve(
          process.cwd(),
          "src/webhooks/__tests__/fixtures/concurrent-ingestion-worker.ts",
        ),
        input.databasePath,
        input.rawBodyBase64,
        input.signature,
        providerEventId,
        webhookSecret,
        receivedAt,
        String(input.startAt),
      ],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    let errorOutput = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      errorOutput += chunk;
    });
    child.on("error", rejectWorker);
    child.on("close", (code) => {
      if (code !== 0) {
        rejectWorker(
          new Error(
            `Concurrent ingestion worker exited ${code}: ${errorOutput}`,
          ),
        );
        return;
      }
      resolveWorker(JSON.parse(output) as { status: string });
    });
  });
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("genuinely concurrent webhook delivery", () => {
  it("converges two separate processes to one event and one audit effect", async () => {
    const directory = mkdtempSync(join(tmpdir(), "recoverai-webhook-race-"));
    directories.push(directory);
    const databasePath = join(directory, "race.db");
    const database = createLocalDatabase(databasePath);
    runDatabaseMigrations(database);
    database.client.close();

    const rawBody = rawWebhookBody();
    const workerInput = {
      databasePath,
      rawBodyBase64: Buffer.from(rawBody).toString("base64"),
      signature: signRawBody(rawBody),
      startAt: Date.now() + 750,
    };
    const outcomes = await Promise.all([
      runWorker(workerInput),
      runWorker(workerInput),
    ]);
    expect(outcomes.map(({ status }) => status).sort()).toEqual([
      "ACCEPTED",
      "DUPLICATE",
    ]);

    const verificationDatabase = createLocalDatabase(databasePath);
    try {
      const count = (table: string) =>
        (
          verificationDatabase.client
            .prepare(`SELECT count(*) AS count FROM ${table}`)
            .get() as { count: number }
        ).count;
      expect({
        events: count("webhook_events"),
        audits: count("audit_entries"),
        cases: count("recovery_cases"),
        actions: count("recovery_actions"),
        links: count("payment_links"),
      }).toEqual({
        events: 1,
        audits: 1,
        cases: 0,
        actions: 0,
        links: 0,
      });
    } finally {
      verificationDatabase.client.close();
    }
  });
});
