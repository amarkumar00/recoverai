import { eq } from "drizzle-orm";

import {
  dashboardScenarioResultSchema,
  demoScenarioDashboardSchema,
  type DashboardScenarioKey,
  type DashboardScenarioResult,
  type DemoScenarioDashboard,
} from "@/dashboard/contracts";
import {
  createDeterministicScenarioResult,
  SCENARIO_CATALOG,
} from "@/dashboard/scenario-catalog";
import type { LocalDatabase } from "@/lib/db/client";
import { demoScenarioRuns } from "@/lib/db/schema";
import {
  PRIMARY_DEMO_SCENARIO,
  UNSAFE_DEMO_SCENARIO,
} from "@/orchestration/demo-scenario";

function parseStoredResult(serialized: string): DashboardScenarioResult {
  return dashboardScenarioResultSchema.parse(JSON.parse(serialized));
}

export class DemoScenarioStore {
  readonly #database: LocalDatabase;

  constructor(database: LocalDatabase) {
    this.#database = database;
  }

  list(): DemoScenarioDashboard {
    const rows = this.#database.db.select().from(demoScenarioRuns).all();
    const byKey = new Map(
      rows.map((row) => [row.scenarioKey, parseStoredResult(row.resultJson)]),
    );
    return demoScenarioDashboardSchema.parse({
      mode: "SYNTHETIC_DEMO",
      resetPreservesAuditHistory: true,
      scenarios: SCENARIO_CATALOG.map((item) => {
        const result = byKey.get(item.scenarioKey);
        return {
          ...item,
          status: result === undefined ? "READY" : "COMPLETED",
          ...(result === undefined ? {} : { result }),
        };
      }),
    });
  }

  run(key: DashboardScenarioKey): DashboardScenarioResult {
    const result = createDeterministicScenarioResult(key);
    this.#database.db
      .insert(demoScenarioRuns)
      .values({
        scenarioKey: key,
        resultJson: JSON.stringify(result),
        completedAt: result.completedAt,
      })
      .onConflictDoUpdate({
        target: demoScenarioRuns.scenarioKey,
        set: {
          resultJson: JSON.stringify(result),
          completedAt: result.completedAt,
        },
      })
      .run();
    return parseStoredResult(
      this.#database.db
        .select()
        .from(demoScenarioRuns)
        .where(eq(demoScenarioRuns.scenarioKey, key))
        .get()!.resultJson,
    );
  }

  resetKnownDemoFixtures(): DemoScenarioDashboard {
    const sqlite = this.#database.client;
    const caseIds = [PRIMARY_DEMO_SCENARIO.caseId, UNSAFE_DEMO_SCENARIO.caseId];
    const paymentIds = [
      PRIMARY_DEMO_SCENARIO.paymentId,
      UNSAFE_DEMO_SCENARIO.paymentId,
    ];
    const providerEventIds = [
      PRIMARY_DEMO_SCENARIO.failureProviderEventId,
      PRIMARY_DEMO_SCENARIO.paidProviderEventId,
      UNSAFE_DEMO_SCENARIO.failureProviderEventId,
      UNSAFE_DEMO_SCENARIO.paidProviderEventId,
    ];
    const placeholders = (values: readonly string[]) =>
      values.map(() => "?").join(",");

    sqlite
      .transaction(() => {
        sqlite.prepare("DELETE FROM demo_scenario_runs").run();
        sqlite
          .prepare(
            `DELETE FROM recovery_actions WHERE case_id IN (${placeholders(caseIds)})`,
          )
          .run(...caseIds);
        sqlite
          .prepare(
            `DELETE FROM payment_links WHERE case_id IN (${placeholders(caseIds)})`,
          )
          .run(...caseIds);
        sqlite
          .prepare(
            `DELETE FROM policy_decisions WHERE case_id IN (${placeholders(caseIds)})`,
          )
          .run(...caseIds);
        sqlite
          .prepare(
            `DELETE FROM ai_recommendations WHERE case_id IN (${placeholders(caseIds)})`,
          )
          .run(...caseIds);
        sqlite
          .prepare(
            `DELETE FROM payment_snapshots WHERE payment_id IN (${placeholders(paymentIds)})`,
          )
          .run(...paymentIds);
        sqlite
          .prepare(
            `DELETE FROM recovery_cases WHERE case_id IN (${placeholders(caseIds)})`,
          )
          .run(...caseIds);
        sqlite
          .prepare(
            `DELETE FROM webhook_events WHERE provider_event_id IN (${placeholders(providerEventIds)})`,
          )
          .run(...providerEventIds);
      })
      .immediate();

    return this.list();
  }
}
