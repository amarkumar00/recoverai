import { mkdtempSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AUDIT_CHAIN_IDENTITY,
  AUDIT_CHAIN_VERSION,
  createSqliteAuditChain,
} from "@/audit";
import { createLocalDatabase, type LocalDatabase } from "@/lib/db/client";
import { runDatabaseMigrations } from "@/lib/db/migrations";

const directories: string[] = [];

function command(index: number, overrides: Record<string, unknown> = {}) {
  return {
    entryId: `audit_chain_${String(index).padStart(3, "0")}`,
    timestamp: `2026-08-25T10:00:${String(index).padStart(2, "0")}.000Z`,
    actor: "AUDIT_SYSTEM",
    inputReference: `case_chain_${String(index).padStart(3, "0")}`,
    eventType: "CHAIN_EVENT_RECORDED",
    reason: `Safe audit event ${index} was recorded.`,
    previousState: null,
    newState: null,
    metadata: { isSynthetic: true, checkCount: index },
    ...overrides,
  };
}

function openDatabase(path?: string) {
  const directory = mkdtempSync(join(tmpdir(), "recoverai-audit-"));
  directories.push(directory);
  const resolvedPath = path ?? join(directory, "audit.db");
  const database = createLocalDatabase(resolvedPath);
  runDatabaseMigrations(database);
  return {
    database,
    path: resolvedPath,
    chain: createSqliteAuditChain(database),
  };
}

function appendThree(database: LocalDatabase) {
  const chain = createSqliteAuditChain(database);
  for (let index = 1; index <= 3; index += 1)
    expect(chain.append(command(index)).status).toBe("APPENDED");
  return chain;
}

function runConcurrentWorker(path: string, index: number, startAt: number) {
  return new Promise<{ status: string; entry?: { sequence: number } }>(
    (resolveWorker, rejectWorker) => {
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          resolve(
            process.cwd(),
            "src/audit/__tests__/fixtures/concurrent-append-worker.ts",
          ),
          path,
          String(index),
          String(startAt),
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
            new Error(`Concurrent writer exited ${code}: ${errorOutput}`),
          );
          return;
        }
        resolveWorker(
          JSON.parse(output) as {
            status: string;
            entry?: { sequence: number };
          },
        );
      });
    },
  );
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("atomic SQLite audit append", () => {
  it("creates a genesis entry at sequence one with a null predecessor", () => {
    const { database, chain } = openDatabase();
    try {
      const result = chain.append(command(1));
      expect(result).toMatchObject({
        status: "APPENDED",
        entry: { sequence: 1, previousHash: null },
      });
    } finally {
      database.client.close();
    }
  });

  it("links each later entry to the prior digest", () => {
    const { database, chain } = openDatabase();
    try {
      const first = chain.append(command(1));
      const second = chain.append(command(2));
      expect(
        second.status === "APPENDED" && first.status === "APPENDED"
          ? second.entry.previousHash
          : null,
      ).toBe(first.status === "APPENDED" ? first.entry.currentHash : "");
    } finally {
      database.client.close();
    }
  });

  it("orders by insertion sequence even when timestamps move backward", () => {
    const { database, chain } = openDatabase();
    try {
      chain.append(command(1, { timestamp: "2026-08-25T10:00:10.000Z" }));
      chain.append(command(2, { timestamp: "2026-08-25T10:00:01.000Z" }));
      expect(chain.readOrdered().map((entry) => entry.entryId)).toEqual([
        "audit_chain_001",
        "audit_chain_002",
      ]);
    } finally {
      database.client.close();
    }
  });

  it("returns an idempotent replay without changing the head", () => {
    const { database, chain } = openDatabase();
    try {
      const first = chain.append(command(1));
      const replay = chain.append(command(1));
      expect(replay.status).toBe("IDEMPOTENT_REPLAY");
      expect(
        replay.status === "IDEMPOTENT_REPLAY" ? replay.checkpoint : null,
      ).toEqual(first.status === "APPENDED" ? first.checkpoint : null);
    } finally {
      database.client.close();
    }
  });

  it("recognizes an identical replay after newer entries", () => {
    const { database, chain } = openDatabase();
    try {
      chain.append(command(1));
      chain.append(command(2));
      chain.append(command(3));
      expect(chain.append(command(1))).toMatchObject({
        status: "IDEMPOTENT_REPLAY",
        entry: { sequence: 1 },
        checkpoint: { entryCount: 3 },
      });
    } finally {
      database.client.close();
    }
  });

  it("rejects an entry ID reused with different content", () => {
    const { database, chain } = openDatabase();
    try {
      chain.append(command(1));
      expect(
        chain.append(command(1, { reason: "Different safe content." })),
      ).toEqual({ status: "ENTRY_ID_CONFLICT" });
    } finally {
      database.client.close();
    }
  });

  it("anchors count, sequence, version, identity, and head hash", () => {
    const { database, chain } = openDatabase();
    try {
      const result = chain.append(command(1));
      expect(chain.checkpoint()).toEqual(
        result.status === "APPENDED"
          ? {
              chainIdentity: AUDIT_CHAIN_IDENTITY,
              chainVersion: AUDIT_CHAIN_VERSION,
              entryCount: 1,
              lastSequence: 1,
              headHash: result.entry.currentHash,
            }
          : null,
      );
    } finally {
      database.client.close();
    }
  });

  it("keeps an empty migrated chain explicitly anchored", () => {
    const { database, chain } = openDatabase();
    try {
      expect(chain.checkpoint()).toEqual({
        chainIdentity: AUDIT_CHAIN_IDENTITY,
        chainVersion: AUDIT_CHAIN_VERSION,
        entryCount: 0,
        lastSequence: 0,
        headHash: null,
      });
    } finally {
      database.client.close();
    }
  });

  it("verifies a valid multi-entry chain", () => {
    const { database } = openDatabase();
    try {
      expect(appendThree(database).verify()).toMatchObject({
        status: "VALID",
        checkpoint: { entryCount: 3 },
      });
    } finally {
      database.client.close();
    }
  });

  it("fails closed when the chain-state row is missing", () => {
    const { database, chain } = openDatabase();
    try {
      database.client.prepare("DELETE FROM audit_chain_state").run();
      expect(chain.append(command(1))).toEqual({ status: "CHAIN_CORRUPT" });
    } finally {
      database.client.close();
    }
  });

  it("fails closed when the head does not match its last row", () => {
    const { database } = openDatabase();
    try {
      const chain = appendThree(database);
      database.client.pragma("ignore_check_constraints = ON");
      database.client
        .prepare("UPDATE audit_chain_state SET head_hash = ?")
        .run("f".repeat(64));
      expect(chain.append(command(4))).toEqual({ status: "CHAIN_CORRUPT" });
    } finally {
      database.client.close();
    }
  });

  it("fails closed when an earlier entry is corrupt", () => {
    const { database } = openDatabase();
    try {
      const chain = appendThree(database);
      database.client
        .prepare("UPDATE audit_entries SET reason = ? WHERE sequence = 1")
        .run("Edited safe reason.");
      expect(chain.append(command(4))).toEqual({ status: "CHAIN_CORRUPT" });
    } finally {
      database.client.close();
    }
  });

  it("rolls back the entry when insertion fails", () => {
    const { database, chain } = openDatabase();
    try {
      database.client.exec(
        "CREATE TRIGGER reject_audit_insert BEFORE INSERT ON audit_entries BEGIN SELECT RAISE(ABORT, 'injected insert failure'); END",
      );
      expect(chain.append(command(1))).toEqual({ status: "CHAIN_CORRUPT" });
      expect(
        database.client
          .prepare("SELECT count(*) AS count FROM audit_entries")
          .get(),
      ).toEqual({ count: 0 });
      expect(chain.checkpoint()).toMatchObject({
        entryCount: 0,
        headHash: null,
      });
    } finally {
      database.client.close();
    }
  });

  it("rolls back the entry when head update fails", () => {
    const { database, chain } = openDatabase();
    try {
      database.client.exec(
        "CREATE TRIGGER reject_head_update BEFORE UPDATE ON audit_chain_state BEGIN SELECT RAISE(ABORT, 'injected head failure'); END",
      );
      expect(chain.append(command(1))).toEqual({ status: "CHAIN_CORRUPT" });
      expect(
        database.client
          .prepare("SELECT count(*) AS count FROM audit_entries")
          .get(),
      ).toEqual({ count: 0 });
      expect(chain.checkpoint()).toMatchObject({
        entryCount: 0,
        headHash: null,
      });
    } finally {
      database.client.close();
    }
  });

  it("serializes competing connections onto distinct contiguous sequences", () => {
    const opened = openDatabase();
    const secondDatabase = createLocalDatabase(opened.path);
    try {
      const secondChain = createSqliteAuditChain(secondDatabase);
      expect(opened.chain.append(command(1))).toMatchObject({
        status: "APPENDED",
        entry: { sequence: 1 },
      });
      expect(secondChain.append(command(2))).toMatchObject({
        status: "APPENDED",
        entry: { sequence: 2 },
      });
      expect(opened.chain.verify()).toMatchObject({
        status: "VALID",
        checkpoint: { entryCount: 2 },
      });
    } finally {
      secondDatabase.client.close();
      opened.database.client.close();
    }
  });

  it("serializes truly concurrent process writers without corrupting the chain", async () => {
    const opened = openDatabase();
    try {
      const startAt = Date.now() + 500;
      const results = await Promise.all([
        runConcurrentWorker(opened.path, 1, startAt),
        runConcurrentWorker(opened.path, 2, startAt),
      ]);
      expect(results.map(({ status }) => status)).toEqual([
        "APPENDED",
        "APPENDED",
      ]);
      expect(results.map(({ entry }) => entry?.sequence).sort()).toEqual([
        1, 2,
      ]);
      expect(opened.chain.verify()).toMatchObject({
        status: "VALID",
        checkpoint: { entryCount: 2 },
      });
    } finally {
      opened.database.client.close();
    }
  });

  it("explicitly rejects legacy pre-hashed rows without a chain state", () => {
    const { database, chain } = openDatabase();
    try {
      database.client.prepare("DELETE FROM audit_chain_state").run();
      database.client
        .prepare(
          "INSERT INTO audit_entries (sequence, entry_id, timestamp, actor, input_reference, event_type, reason, previous_state, new_state, previous_hash, current_hash, metadata_json) VALUES (1, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)",
        )
        .run(
          "audit_legacy_001",
          "2026-08-25T10:00:00.000Z",
          "AUDIT_SYSTEM",
          "case_legacy_001",
          "LEGACY_IMPORTED",
          "Legacy passive row.",
          "a".repeat(64),
          "{}",
        );
      expect(chain.verify()).toEqual({
        status: "INVALID",
        issue: "CHAIN_STATE_MISSING",
      });
    } finally {
      database.client.close();
    }
  });
});
