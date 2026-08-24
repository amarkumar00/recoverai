import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DeterministicMockRazorpayAdapter } from "@/adapters/razorpay";
import { createSqliteAuditChain } from "@/audit";
import { createLocalDatabase } from "@/lib/db/client";
import { runDatabaseMigrations } from "@/lib/db/migrations";
import {
  PRIMARY_DEMO_SCENARIO,
  UNSAFE_DEMO_SCENARIO,
} from "@/orchestration/demo-scenario";
import {
  DEMO_FAILPOINTS,
  DemoInterruption,
  RecoverAiDemoOrchestrator,
  type DemoFailpoint,
} from "@/orchestration/recovery-orchestrator";
import { DemoReadModelService } from "@/orchestration/read-model";
import { createSqliteRepositories } from "@/repositories/sqlite";

const directories: string[] = [];

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "recoverai-m9-"));
  directories.push(directory);
  const database = createLocalDatabase(join(directory, "demo.db"));
  runDatabaseMigrations(database);
  const repositories = createSqliteRepositories(database);
  const audit = createSqliteAuditChain(database);
  const adapters: DeterministicMockRazorpayAdapter[] = [];
  const orchestrator = new RecoverAiDemoOrchestrator({
    repositories,
    audit,
    adapterFactory(fixtures) {
      const adapter = new DeterministicMockRazorpayAdapter(fixtures);
      adapters.push(adapter);
      return adapter;
    },
  });
  return {
    database,
    repositories,
    audit,
    adapters,
    orchestrator,
    readModel: new DemoReadModelService({
      repositories,
      audit,
      orchestrator,
    }),
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function countCalls(
  adapters: DeterministicMockRazorpayAdapter[],
  operation: "FETCH_PAYMENT" | "CREATE_PAYMENT_LINK",
) {
  return adapters
    .flatMap((adapter) => adapter.getCallLog())
    .filter((entry) => entry.operation === operation).length;
}

async function expectInterrupted(
  operation: Promise<unknown>,
  failpoint: DemoFailpoint,
) {
  await expect(operation).rejects.toMatchObject({
    name: "DemoInterruption",
    failpoint,
  } satisfies Partial<DemoInterruption>);
}

describe("Milestone 9 credential-free vertical slice", () => {
  it("runs one bounded recovery from trusted synthetic failure to recovered", async () => {
    const env = setup();
    try {
      await expect(
        env.orchestrator.startOrResumePrimary(),
      ).resolves.toMatchObject({
        status: "EXECUTED",
        resultCode: "SIMULATED_PAYMENT_LINK_READY",
      });
      const ready = await env.readModel.caseById(PRIMARY_DEMO_SCENARIO.caseId);
      expect(ready).toMatchObject({
        sourceBoundary: "Trusted Synthetic Demo Event",
        signatureStatus: "NOT_CHECKED",
        currentCaseState: "LINK_CREATED",
        workflowStage: "READY_FOR_SIMULATED_PAYMENT",
        customerContactCount: 1,
        paymentLink: { status: "CREATED" },
        auditVerification: { status: "VALID" },
      });

      await expect(env.orchestrator.completePrimary()).resolves.toMatchObject({
        status: "EXECUTED",
        resultCode: "SIMULATED_RECOVERY_COMPLETE",
      });
      const complete = await env.readModel.caseById(
        PRIMARY_DEMO_SCENARIO.caseId,
      );
      expect(complete).toMatchObject({
        currentCaseState: "RECOVERED",
        workflowStage: "RECOVERED_STOPPED",
        customerContactCount: 1,
        paymentLink: { status: "PAID" },
        controls: { noFurtherAction: true },
        auditVerification: { status: "VALID" },
      });
      expect(
        env.repositories.webhookEvents.findByProviderEventId(
          PRIMARY_DEMO_SCENARIO.failureProviderEventId,
        )?.event.signatureVerification.status,
      ).toBe("NOT_CHECKED");
      expect(
        env.repositories.webhookEvents.findByProviderEventId(
          PRIMARY_DEMO_SCENARIO.paidProviderEventId,
        ),
      ).not.toBeNull();
    } finally {
      env.database.client.close();
    }
  });

  it("replays start and completion without duplicate money or contact actions", async () => {
    const env = setup();
    try {
      await env.orchestrator.startOrResumePrimary();
      await env.orchestrator.startOrResumePrimary();
      await env.orchestrator.completePrimary();
      await env.orchestrator.completePrimary();
      await env.orchestrator.startOrResumePrimary();

      expect(
        env.repositories.recoveryActions.listByCaseId(
          PRIMARY_DEMO_SCENARIO.caseId,
        ),
      ).toHaveLength(1);
      expect(
        env.repositories.paymentLinks.listByCaseId(
          PRIMARY_DEMO_SCENARIO.caseId,
        ),
      ).toHaveLength(1);
      expect(
        env.repositories.aiRecommendations.listByCaseId(
          PRIMARY_DEMO_SCENARIO.caseId,
        ),
      ).toHaveLength(1);
      expect(
        env.repositories.policyDecisions.listByCaseId(
          PRIMARY_DEMO_SCENARIO.caseId,
        ),
      ).toHaveLength(1);
      expect(
        env.repositories.recoveryCases.findById(PRIMARY_DEMO_SCENARIO.caseId),
      ).toMatchObject({ state: "RECOVERED", contactCount: 1 });
      expect(countCalls(env.adapters, "CREATE_PAYMENT_LINK")).toBe(1);
      const auditTypes = env.audit
        .readOrdered()
        .map((entry) => entry.eventType);
      expect(auditTypes).toContain("KNOWN_ERROR_DIAGNOSIS_PRODUCED");
      expect(auditTypes).toContain("SYNTHETIC_EVENT_RESUMED");
      expect(auditTypes).toContain("RECOVERY_ALREADY_COMPLETE");
    } finally {
      env.database.client.close();
    }
  });

  it.each(DEMO_FAILPOINTS.slice(0, 5))(
    "resumes safely after %s",
    async (failpoint) => {
      const env = setup();
      try {
        await expectInterrupted(
          env.orchestrator.startOrResumePrimary({ failpoint }),
          failpoint,
        );
        await env.orchestrator.startOrResumePrimary();
        expect(
          env.repositories.recoveryCases.findById(PRIMARY_DEMO_SCENARIO.caseId),
        ).toMatchObject({ state: "LINK_CREATED", contactCount: 1 });
        expect(
          env.repositories.paymentLinks.listByCaseId(
            PRIMARY_DEMO_SCENARIO.caseId,
          ),
        ).toHaveLength(1);
        expect(countCalls(env.adapters, "CREATE_PAYMENT_LINK")).toBe(1);
        expect(env.audit.verify()).toMatchObject({ status: "VALID" });
      } finally {
        env.database.client.close();
      }
    },
  );

  it.each(["AFTER_LINK_PAYMENT", "BEFORE_FINAL_AUDIT"] as const)(
    "resumes completion safely after %s",
    async (failpoint) => {
      const env = setup();
      try {
        await env.orchestrator.startOrResumePrimary();
        await expectInterrupted(
          env.orchestrator.completePrimary({ failpoint }),
          failpoint,
        );
        await env.orchestrator.completePrimary();
        expect(
          env.repositories.recoveryCases.findById(PRIMARY_DEMO_SCENARIO.caseId),
        ).toMatchObject({ state: "RECOVERED", contactCount: 1 });
        expect(
          env.repositories.paymentLinks.listByCaseId(
            PRIMARY_DEMO_SCENARIO.caseId,
          ),
        ).toEqual([expect.objectContaining({ status: "PAID" })]);
        expect(env.audit.verify()).toMatchObject({ status: "VALID" });
      } finally {
        env.database.client.close();
      }
    },
  );

  it("blocks the fixed 10x unsafe amount before executor or link creation", async () => {
    const env = setup();
    try {
      await expect(
        env.orchestrator.runUnsafeAmountProbe(),
      ).resolves.toMatchObject({
        status: "BLOCKED_SAFE",
        resultCode: "INTENT_MONEY_INTEGRITY",
      });
      await expect(
        env.orchestrator.runUnsafeAmountProbe(),
      ).resolves.toMatchObject({ status: "IDEMPOTENT_REPLAY" });
      expect(
        env.repositories.recoveryCases.findById(UNSAFE_DEMO_SCENARIO.caseId),
      ).toMatchObject({ state: "ESCALATED", contactCount: 0 });
      expect(
        env.repositories.recoveryActions.listByCaseId(
          UNSAFE_DEMO_SCENARIO.caseId,
        ),
      ).toHaveLength(0);
      expect(
        env.repositories.paymentLinks.listByCaseId(UNSAFE_DEMO_SCENARIO.caseId),
      ).toHaveLength(0);
      expect(env.adapters).toHaveLength(0);
      expect(
        await env.readModel.caseById(UNSAFE_DEMO_SCENARIO.caseId),
      ).toMatchObject({
        workflowStage: "UNSAFE_ACTION_BLOCKED",
        unsafeProof: {
          rejectingRule: "INTENT_MONEY_INTEGRITY",
          noActionExecuted: true,
        },
      });
      expect(env.audit.verify()).toMatchObject({ status: "VALID" });
    } finally {
      env.database.client.close();
    }
  });

  it("returns a dashboard-safe read model without private or executable fields", async () => {
    const env = setup();
    try {
      await env.orchestrator.startOrResumePrimary();
      const serialized = JSON.stringify(await env.readModel.dashboard());
      expect(serialized).toContain("simulatedAmountSubunits");
      expect(serialized).not.toContain("syntheticCustomerHash");
      expect(serialized).not.toContain("publicUrl");
      expect(serialized).not.toContain("currentHash");
      expect(serialized).not.toContain("previousHash");
      expect(serialized).not.toMatch(
        /apiKey|webhookSecret|rawPayload|syntheticCustomerHash/i,
      );
    } finally {
      env.database.client.close();
    }
  });
});
