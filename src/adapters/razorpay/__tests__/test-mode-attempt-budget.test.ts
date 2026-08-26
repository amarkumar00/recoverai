import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SqliteTestModeLinkAttemptBudget } from "@/adapters/razorpay/test-mode-attempt-budget";
import { createLocalDatabase, type LocalDatabase } from "@/lib/db/client";
import { runDatabaseMigrations } from "@/lib/db/migrations";

const databases: LocalDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.client.close();
});

describe("durable local Test Mode link-attempt budget", () => {
  it("permits only three unique attempts and treats replay as existing", () => {
    const database = createLocalDatabase(":memory:");
    databases.push(database);
    runDatabaseMigrations(database);
    const firstProcess = new SqliteTestModeLinkAttemptBudget(database);
    const secondProcess = new SqliteTestModeLinkAttemptBudget(database);
    expect(
      firstProcess.claim("reference_1", "2026-08-26T10:00:00.000Z"),
    ).toEqual({ status: "ALLOWED" });
    firstProcess.recordOutcome(
      "reference_1",
      "OUTCOME_UNCERTAIN",
      "2026-08-26T10:00:01.000Z",
    );
    expect(
      secondProcess.claim("reference_1", "2026-08-26T10:00:02.000Z"),
    ).toEqual({ status: "EXISTING", outcome: "OUTCOME_UNCERTAIN" });
    expect(
      secondProcess.claim("reference_2", "2026-08-26T10:00:03.000Z"),
    ).toEqual({ status: "ALLOWED" });
    expect(
      firstProcess.claim("reference_3", "2026-08-26T10:00:04.000Z"),
    ).toEqual({ status: "ALLOWED" });
    expect(
      firstProcess.claim("reference_4", "2026-08-26T10:00:05.000Z"),
    ).toEqual({ status: "LIMIT_REACHED" });
  });
});
