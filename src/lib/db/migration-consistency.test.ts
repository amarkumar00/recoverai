import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getTableConfig } from "drizzle-orm/sqlite-core";
import { afterEach, describe, expect, it } from "vitest";

import { createLocalDatabase } from "@/lib/db/client";
import { runDatabaseMigrations } from "@/lib/db/migrations";
import { recoverAiSchema } from "@/lib/db/schema";

const REQUIRED_TABLES = [
  "webhook_events",
  "payment_snapshots",
  "recovery_cases",
  "ai_recommendations",
  "policy_decisions",
  "recovery_actions",
  "payment_links",
  "audit_entries",
  "audit_chain_state",
  "evaluation_runs",
  "demo_scenario_runs",
] as const;

const IMPORTANT_INDEXES = [
  "webhook_events_provider_event_id_uq",
  "payment_snapshots_payment_latest_idx",
  "payment_snapshots_source_origin_uq",
  "recovery_cases_payment_id_uq",
  "ai_recommendations_case_recommended_idx",
  "policy_decisions_case_decided_idx",
  "recovery_actions_idempotency_key_uq",
  "payment_links_reference_id_uq",
  "payment_links_one_blocking_per_order_uq",
  "audit_entries_timestamp_sequence_idx",
  "evaluation_runs_completed_at_idx",
] as const;

const temporaryDirectories: string[] = [];

function createMigratedFileDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "recoverai-migrations-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "clean.db");
  const database = createLocalDatabase(path);
  runDatabaseMigrations(database);
  return { ...database, path };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("committed database migrations", () => {
  it("creates a clean file database and safely applies migrations again", () => {
    const database = createMigratedFileDatabase();

    try {
      expect(() => runDatabaseMigrations(database)).not.toThrow();
      expect(database.client.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(database.client.pragma("busy_timeout", { simple: true })).toBe(
        5_000,
      );
      expect(database.client.pragma("journal_mode", { simple: true })).toBe(
        "wal",
      );

      const migrationCount = database.client
        .prepare("SELECT count(*) AS count FROM __drizzle_migrations")
        .get() as { count: number };
      expect(migrationCount.count).toBe(4);
    } finally {
      database.client.close();
    }
  });

  it("contains every required table and financial-safety index", () => {
    const database = createMigratedFileDatabase();

    try {
      const schemaObjects = database.client
        .prepare(
          "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'index')",
        )
        .all() as Array<{ name: string; type: "table" | "index" }>;
      const tableNames = new Set(
        schemaObjects
          .filter(({ type }) => type === "table")
          .map(({ name }) => name),
      );
      const indexNames = new Set(
        schemaObjects
          .filter(({ type }) => type === "index")
          .map(({ name }) => name),
      );

      for (const table of REQUIRED_TABLES) {
        expect(tableNames).toContain(table);
      }
      for (const index of IMPORTANT_INDEXES) {
        expect(indexNames).toContain(index);
      }
    } finally {
      database.client.close();
    }
  });

  it("keeps committed migration columns consistent with Drizzle definitions", () => {
    const database = createMigratedFileDatabase();

    try {
      for (const table of Object.values(recoverAiSchema)) {
        const config = getTableConfig(table);
        const migratedColumns = database.client
          .prepare(`PRAGMA table_info("${config.name}")`)
          .all() as Array<{ name: string }>;

        expect(migratedColumns.map(({ name }) => name)).toEqual(
          config.columns.map(({ name }) => name),
        );
      }
    } finally {
      database.client.close();
    }
  });
});
