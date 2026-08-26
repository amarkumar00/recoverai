import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createHeldOutDigitalTwin } from "@/digital-twin/evaluator-only";
import { runAndPersistHeldOutEvaluation } from "@/evaluation/persistence";
import { createLocalDatabase } from "@/lib/db/client";
import { runDatabaseMigrations } from "@/lib/db/migrations";
import { createSqliteRepositories } from "@/repositories/sqlite";

describe("held-out evaluation persistence", () => {
  it("stores an identical deterministic replay once through the existing repository boundary", async () => {
    const directory = mkdtempSync(join(tmpdir(), "recoverai-evaluation-"));
    const database = createLocalDatabase(join(directory, "evaluation.db"));
    runDatabaseMigrations(database);
    const repository = createSqliteRepositories(database).evaluationRuns;

    try {
      const firstTwin = createHeldOutDigitalTwin();
      const first = await runAndPersistHeldOutEvaluation({
        selectionBatch: firstTwin.selectionBatch,
        oracle: firstTwin.evaluator,
        repository,
      });
      const secondTwin = createHeldOutDigitalTwin();
      const second = await runAndPersistHeldOutEvaluation({
        selectionBatch: secondTwin.selectionBatch,
        oracle: secondTwin.evaluator,
        repository,
      });

      expect(second).toEqual(first);
      expect(repository.findById(first.result.evaluationRunId)).toEqual(first);
      expect(
        database.client
          .prepare("SELECT COUNT(*) AS count FROM evaluation_runs")
          .get(),
      ).toEqual({ count: 1 });
    } finally {
      database.client.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
