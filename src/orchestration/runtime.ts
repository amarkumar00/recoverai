import "server-only";

import { DeterministicMockRazorpayAdapter } from "@/adapters/razorpay";
import { createSqliteAuditChain } from "@/audit";
import { DashboardReadModelService } from "@/dashboard/read-model";
import { DemoScenarioStore } from "@/dashboard/scenario-store";
import { createLocalDatabase } from "@/lib/db/client";
import { DemoReadModelService } from "@/orchestration/read-model";
import { RecoverAiDemoOrchestrator } from "@/orchestration/recovery-orchestrator";
import { PaymentStateReconciler } from "@/reconciliation";
import { createSqliteRepositories } from "@/repositories/sqlite";
import {
  SecureRazorpayWebhookIngestor,
  VerifiedWebhookAuditProcessor,
  VerifiedWebhookReconciliationProcessor,
} from "@/webhooks";

let singleton: ReturnType<typeof createRuntime> | undefined;

function createRuntime() {
  const database = createLocalDatabase();
  const repositories = createSqliteRepositories(database);
  const audit = createSqliteAuditChain(database);
  const orchestrator = new RecoverAiDemoOrchestrator({ repositories, audit });
  const publicMockAdapter = new DeterministicMockRazorpayAdapter();
  const reconciler = new PaymentStateReconciler({
    adapter: publicMockAdapter,
    repositories,
    audit,
  });
  const webhookIngestor = new SecureRazorpayWebhookIngestor({
    repositories,
    processor: new VerifiedWebhookReconciliationProcessor(
      new VerifiedWebhookAuditProcessor(audit),
      reconciler,
    ),
  });
  const readModel = new DemoReadModelService({
    repositories,
    audit,
    orchestrator,
  });
  const scenarios = new DemoScenarioStore(database);
  const dashboard = new DashboardReadModelService({
    database,
    audit,
    scenarios,
  });
  return {
    database,
    repositories,
    audit,
    orchestrator,
    readModel,
    webhookIngestor,
    reconciler,
    scenarios,
    dashboard,
  };
}

export function applicationRuntime() {
  singleton ??= createRuntime();
  return singleton;
}

export function demoRuntime() {
  return applicationRuntime();
}
