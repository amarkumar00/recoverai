import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createSqliteAuditChain,
  type AuditVerificationIssueCode,
} from "@/audit";
import { createLocalDatabase } from "@/lib/db/client";
import { runDatabaseMigrations } from "@/lib/db/migrations";

const directories: string[] = [];

function command(index: number) {
  return {
    entryId: `audit_tamper_${index}`,
    timestamp: `2026-08-25T11:00:0${index}.000Z`,
    actor: "AUDIT_SYSTEM",
    inputReference: `case_tamper_${index}`,
    eventType: "TAMPER_TEST_RECORDED",
    reason: `Safe tamper test event ${index}.`,
    previousState: index === 1 ? null : "VERIFYING",
    newState: index === 1 ? "VERIFYING" : "DIAGNOSED",
    metadata: {
      caseId: `case_tamper_${index}`,
      isSynthetic: true,
      checkCount: index,
    },
  };
}

function openPopulated() {
  const directory = mkdtempSync(join(tmpdir(), "recoverai-tamper-"));
  directories.push(directory);
  const database = createLocalDatabase(join(directory, "audit.db"));
  runDatabaseMigrations(database);
  const chain = createSqliteAuditChain(database);
  for (let index = 1; index <= 3; index += 1)
    expect(chain.append(command(index)).status).toBe("APPENDED");
  return { database, chain };
}

function expectIssue(
  actual: ReturnType<ReturnType<typeof openPopulated>["chain"]["verify"]>,
  issue: AuditVerificationIssueCode,
) {
  expect(actual).toMatchObject({ status: "INVALID", issue });
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("tamper detection", () => {
  it.each([
    ["entry_id", "audit_tamper_edited"],
    ["timestamp", "2026-08-25T11:30:01.000Z"],
    ["actor", "HUMAN_OPERATOR"],
    ["input_reference", "case_tamper_edited"],
    ["event_type", "TAMPER_EDITED"],
    ["reason", "Edited but privacy-safe reason."],
    ["previous_state", "DETECTED"],
    ["new_state", "ESCALATED"],
  ])("detects editing hashed field %s", (column, value) => {
    const { database, chain } = openPopulated();
    try {
      database.client
        .prepare(`UPDATE audit_entries SET ${column} = ? WHERE sequence = 2`)
        .run(value);
      expectIssue(chain.verify(), "CURRENT_HASH_MISMATCH");
    } finally {
      database.client.close();
    }
  });

  it("detects editing allowlisted metadata", () => {
    const { database, chain } = openPopulated();
    try {
      database.client
        .prepare(
          "UPDATE audit_entries SET metadata_json = ? WHERE sequence = 2",
        )
        .run('{"isSynthetic":true,"checkCount":99}');
      expectIssue(chain.verify(), "CURRENT_HASH_MISMATCH");
    } finally {
      database.client.close();
    }
  });

  it("detects editing the stored current hash", () => {
    const { database, chain } = openPopulated();
    try {
      database.client
        .prepare("UPDATE audit_entries SET current_hash = ? WHERE sequence = 2")
        .run("f".repeat(64));
      expectIssue(chain.verify(), "CURRENT_HASH_MISMATCH");
    } finally {
      database.client.close();
    }
  });

  it("detects editing a non-genesis previous hash", () => {
    const { database, chain } = openPopulated();
    try {
      database.client
        .prepare(
          "UPDATE audit_entries SET previous_hash = ? WHERE sequence = 2",
        )
        .run("f".repeat(64));
      expectIssue(chain.verify(), "PREVIOUS_HASH_MISMATCH");
    } finally {
      database.client.close();
    }
  });

  it("detects a forged genesis predecessor", () => {
    const { database, chain } = openPopulated();
    try {
      database.client
        .prepare(
          "UPDATE audit_entries SET previous_hash = ? WHERE sequence = 1",
        )
        .run("f".repeat(64));
      expectIssue(chain.verify(), "GENESIS_PREVIOUS_HASH_INVALID");
    } finally {
      database.client.close();
    }
  });

  it.each([
    [1, "SEQUENCE_GAP"],
    [2, "SEQUENCE_GAP"],
    [3, "HEAD_COUNT_MISMATCH"],
  ] as const)("detects deletion of entry %s", (sequence, issue) => {
    const { database, chain } = openPopulated();
    try {
      database.client
        .prepare("DELETE FROM audit_entries WHERE sequence = ?")
        .run(sequence);
      expectIssue(chain.verify(), issue);
    } finally {
      database.client.close();
    }
  });

  it("detects sequence reordering", () => {
    const { database, chain } = openPopulated();
    try {
      database.client.exec(
        "UPDATE audit_entries SET sequence = 100 WHERE sequence = 1; UPDATE audit_entries SET sequence = 1 WHERE sequence = 2; UPDATE audit_entries SET sequence = 2 WHERE sequence = 100;",
      );
      expectIssue(chain.verify(), "GENESIS_PREVIOUS_HASH_INVALID");
    } finally {
      database.client.close();
    }
  });

  it("detects an inserted forged final entry", () => {
    const { database, chain } = openPopulated();
    try {
      const head = chain.checkpoint()!.headHash;
      database.client
        .prepare(
          "INSERT INTO audit_entries (sequence, entry_id, timestamp, actor, input_reference, event_type, reason, previous_state, new_state, previous_hash, current_hash, metadata_json) VALUES (4, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)",
        )
        .run(
          "audit_forged_4",
          "2026-08-25T11:00:04.000Z",
          "AUDIT_SYSTEM",
          "case_forged_4",
          "FORGED_EVENT",
          "Forged entry.",
          head,
          "a".repeat(64),
          "{}",
        );
      expectIssue(chain.verify(), "CURRENT_HASH_MISMATCH");
    } finally {
      database.client.close();
    }
  });

  it("detects a copied semantic entry inserted under a new entry ID", () => {
    const { database, chain } = openPopulated();
    try {
      const row = database.client
        .prepare("SELECT * FROM audit_entries WHERE sequence = 2")
        .get() as Record<string, unknown>;
      database.client
        .prepare(
          "INSERT INTO audit_entries (sequence, entry_id, timestamp, actor, input_reference, event_type, reason, previous_state, new_state, previous_hash, current_hash, metadata_json) VALUES (4, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "audit_tamper_copy",
          row.timestamp,
          row.actor,
          row.input_reference,
          row.event_type,
          row.reason,
          row.previous_state,
          row.new_state,
          chain.checkpoint()!.headHash,
          row.current_hash,
          row.metadata_json,
        );
      expectIssue(chain.verify(), "CURRENT_HASH_MISMATCH");
    } finally {
      database.client.close();
    }
  });

  it("detects an inserted forged middle entry", () => {
    const { database, chain } = openPopulated();
    try {
      database.client.exec(
        "UPDATE audit_entries SET sequence = 30 WHERE sequence = 3; UPDATE audit_entries SET sequence = 3 WHERE sequence = 2; UPDATE audit_entries SET sequence = 2 WHERE sequence = 30;",
      );
      expectIssue(chain.verify(), "PREVIOUS_HASH_MISMATCH");
    } finally {
      database.client.close();
    }
  });

  it("detects a sequence gap", () => {
    const { database, chain } = openPopulated();
    try {
      database.client
        .prepare("UPDATE audit_entries SET sequence = 4 WHERE sequence = 3")
        .run();
      expectIssue(chain.verify(), "SEQUENCE_GAP");
    } finally {
      database.client.close();
    }
  });

  it("detects malformed stored metadata JSON", () => {
    const { database, chain } = openPopulated();
    try {
      database.client
        .prepare(
          "UPDATE audit_entries SET metadata_json = ? WHERE sequence = 2",
        )
        .run("{");
      expectIssue(chain.verify(), "STORED_METADATA_INVALID");
    } finally {
      database.client.close();
    }
  });

  it("detects non-allowlisted stored metadata", () => {
    const { database, chain } = openPopulated();
    try {
      database.client
        .prepare(
          "UPDATE audit_entries SET metadata_json = ? WHERE sequence = 2",
        )
        .run('{"customerEmail":"person@example.com"}');
      expectIssue(chain.verify(), "STORED_METADATA_INVALID");
    } finally {
      database.client.close();
    }
  });

  it("detects secret-like content in an allowlisted stored metadata field", () => {
    const { database, chain } = openPopulated();
    try {
      database.client
        .prepare(
          "UPDATE audit_entries SET metadata_json = ? WHERE sequence = 2",
        )
        .run('{"providerStatus":"api_key exposed"}');
      expectIssue(chain.verify(), "STORED_METADATA_INVALID");
    } finally {
      database.client.close();
    }
  });

  it("detects an invalid stored entry schema", () => {
    const { database, chain } = openPopulated();
    try {
      database.client.pragma("ignore_check_constraints = ON");
      database.client
        .prepare("UPDATE audit_entries SET actor = ? WHERE sequence = 2")
        .run("UNKNOWN_ACTOR");
      expectIssue(chain.verify(), "ENTRY_SCHEMA_INVALID");
    } finally {
      database.client.close();
    }
  });

  it("detects a duplicate stored entry ID even if the storage constraint is bypassed", () => {
    const { database, chain } = openPopulated();
    try {
      database.client.exec("DROP INDEX audit_entries_entry_id_uq");
      database.client
        .prepare("UPDATE audit_entries SET entry_id = ? WHERE sequence = 2")
        .run("audit_tamper_1");
      expectIssue(chain.verify(), "ENTRY_ID_DUPLICATE");
    } finally {
      database.client.close();
    }
  });

  it("detects a missing local head anchor", () => {
    const { database, chain } = openPopulated();
    try {
      database.client.prepare("DELETE FROM audit_chain_state").run();
      expectIssue(chain.verify(), "CHAIN_STATE_MISSING");
    } finally {
      database.client.close();
    }
  });

  it("detects a changed chain version", () => {
    const { database, chain } = openPopulated();
    try {
      database.client
        .prepare("UPDATE audit_chain_state SET chain_version = ?")
        .run("RECOVERAI_AUDIT_V0");
      expectIssue(chain.verify(), "CHAIN_VERSION_MISMATCH");
    } finally {
      database.client.close();
    }
  });

  it("detects a forged local head count", () => {
    const { database, chain } = openPopulated();
    try {
      database.client.pragma("ignore_check_constraints = ON");
      database.client
        .prepare(
          "UPDATE audit_chain_state SET entry_count = 2, last_sequence = 2",
        )
        .run();
      expectIssue(chain.verify(), "HEAD_COUNT_MISMATCH");
    } finally {
      database.client.close();
    }
  });

  it("detects a forged local head hash", () => {
    const { database, chain } = openPopulated();
    try {
      database.client
        .prepare("UPDATE audit_chain_state SET head_hash = ?")
        .run("f".repeat(64));
      expectIssue(chain.verify(), "HEAD_HASH_MISMATCH");
    } finally {
      database.client.close();
    }
  });

  it("detects evolution beyond a retained external checkpoint", () => {
    const { database, chain } = openPopulated();
    try {
      const retained = chain.checkpoint()!;
      expect(chain.append(command(4)).status).toBe("APPENDED");
      expectIssue(chain.verify(retained), "CHECKPOINT_MISMATCH");
    } finally {
      database.client.close();
    }
  });

  it("detects an external checkpoint count mismatch", () => {
    const { database, chain } = openPopulated();
    try {
      const retained = chain.checkpoint()!;
      expectIssue(
        chain.verify({ ...retained, entryCount: 2, lastSequence: 2 }),
        "CHECKPOINT_MISMATCH",
      );
    } finally {
      database.client.close();
    }
  });

  it("detects an external checkpoint hash mismatch", () => {
    const { database, chain } = openPopulated();
    try {
      const retained = chain.checkpoint()!;
      expectIssue(
        chain.verify({ ...retained, headHash: "f".repeat(64) }),
        "CHECKPOINT_MISMATCH",
      );
    } finally {
      database.client.close();
    }
  });

  it("rejects an entirely recomputed local replacement against a retained checkpoint", () => {
    const { database, chain } = openPopulated();
    try {
      const retained = chain.checkpoint()!;
      database.client.exec(
        "DELETE FROM audit_entries; UPDATE audit_chain_state SET entry_count = 0, last_sequence = 0, head_hash = NULL",
      );
      for (let index = 4; index <= 6; index += 1) {
        expect(chain.append(command(index)).status).toBe("APPENDED");
      }
      expect(chain.verify()).toMatchObject({ status: "VALID" });
      expectIssue(chain.verify(retained), "CHECKPOINT_MISMATCH");
    } finally {
      database.client.close();
    }
  });

  it("returns only a safe issue code and sequence for unsafe stored content", () => {
    const { database, chain } = openPopulated();
    try {
      database.client
        .prepare("UPDATE audit_entries SET reason = ? WHERE sequence = 2")
        .run("Contact person@example.com");
      const result = chain.verify();
      expect(result).toEqual({
        status: "INVALID",
        issue: "ENTRY_SCHEMA_INVALID",
        sequence: 2,
      });
      expect(JSON.stringify(result)).not.toContain("example.com");
    } finally {
      database.client.close();
    }
  });

  it("does not log hashes or preimages during append and verification", () => {
    const { database, chain } = openPopulated();
    const originalLog = console.log;
    const messages: unknown[][] = [];
    console.log = (...values: unknown[]) => {
      messages.push(values);
    };
    try {
      expect(chain.append(command(4)).status).toBe("APPENDED");
      expect(chain.verify()).toMatchObject({ status: "VALID" });
      expect(messages).toEqual([]);
    } finally {
      console.log = originalLog;
      database.client.close();
    }
  });

  it("accepts a matching retained external checkpoint", () => {
    const { database, chain } = openPopulated();
    try {
      expect(chain.verify(chain.checkpoint()!)).toMatchObject({
        status: "VALID",
      });
    } finally {
      database.client.close();
    }
  });
});
