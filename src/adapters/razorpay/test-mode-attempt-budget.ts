import "server-only";

import { createHash } from "node:crypto";

import type { LocalDatabase } from "@/lib/db/client";

export const RECOVERAI_TEST_MODE_LINK_ATTEMPT_LIMIT = 3 as const;

export type TestModeAttemptOutcome =
  "CLAIMED" | "CREATED" | "FAILED_SAFE" | "OUTCOME_UNCERTAIN";

export type TestModeAttemptClaim =
  | { status: "ALLOWED" }
  | { status: "EXISTING"; outcome: TestModeAttemptOutcome }
  | { status: "LIMIT_REACHED" };

export interface TestModeLinkAttemptBudget {
  claim(referenceId: string, requestedAt: string): TestModeAttemptClaim;
  recordOutcome(
    referenceId: string,
    outcome: Exclude<TestModeAttemptOutcome, "CLAIMED">,
    updatedAt: string,
  ): void;
}

function attemptId(referenceId: string) {
  return `test_attempt_${createHash("sha256")
    .update(`recoverai_test_mode_attempt_v1:${referenceId}`)
    .digest("hex")
    .slice(0, 24)}`;
}

export class SqliteTestModeLinkAttemptBudget implements TestModeLinkAttemptBudget {
  readonly #database: LocalDatabase;

  constructor(database: LocalDatabase) {
    this.#database = database;
  }

  claim(referenceId: string, requestedAt: string): TestModeAttemptClaim {
    return this.#database.client
      .transaction(() => {
        const existing = this.#database.client
          .prepare(
            "SELECT outcome FROM test_mode_link_attempts WHERE reference_id = ?",
          )
          .get(referenceId) as { outcome: TestModeAttemptOutcome } | undefined;
        if (existing !== undefined) {
          return { status: "EXISTING", outcome: existing.outcome } as const;
        }
        const count = this.#database.client
          .prepare("SELECT count(*) AS count FROM test_mode_link_attempts")
          .get() as { count: number };
        if (count.count >= RECOVERAI_TEST_MODE_LINK_ATTEMPT_LIMIT) {
          return { status: "LIMIT_REACHED" } as const;
        }
        this.#database.client
          .prepare(
            "INSERT INTO test_mode_link_attempts (attempt_id, reference_id, outcome, created_at, updated_at) VALUES (?, ?, 'CLAIMED', ?, ?)",
          )
          .run(attemptId(referenceId), referenceId, requestedAt, requestedAt);
        return { status: "ALLOWED" } as const;
      })
      .immediate();
  }

  recordOutcome(
    referenceId: string,
    outcome: Exclude<TestModeAttemptOutcome, "CLAIMED">,
    updatedAt: string,
  ) {
    this.#database.client
      .prepare(
        "UPDATE test_mode_link_attempts SET outcome = ?, updated_at = ? WHERE reference_id = ?",
      )
      .run(outcome, updatedAt, referenceId);
  }
}

export class InMemoryTestModeLinkAttemptBudget implements TestModeLinkAttemptBudget {
  readonly #attempts = new Map<string, TestModeAttemptOutcome>();

  claim(referenceId: string): TestModeAttemptClaim {
    const existing = this.#attempts.get(referenceId);
    if (existing !== undefined)
      return { status: "EXISTING", outcome: existing };
    if (this.#attempts.size >= RECOVERAI_TEST_MODE_LINK_ATTEMPT_LIMIT) {
      return { status: "LIMIT_REACHED" };
    }
    this.#attempts.set(referenceId, "CLAIMED");
    return { status: "ALLOWED" };
  }

  recordOutcome(
    referenceId: string,
    outcome: Exclude<TestModeAttemptOutcome, "CLAIMED">,
  ) {
    if (this.#attempts.has(referenceId))
      this.#attempts.set(referenceId, outcome);
  }
}
