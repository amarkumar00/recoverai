import "server-only";

import { DeterministicMockRazorpayAdapter } from "@/adapters/razorpay";
import { RazorpayTestModeAdapter } from "@/adapters/razorpay/test-mode-adapter";
import { SqliteTestModeLinkAttemptBudget } from "@/adapters/razorpay/test-mode-attempt-budget";
import { NativeRazorpayTestModeTransport } from "@/adapters/razorpay/test-mode-transport";
import { createSqliteAuditChain } from "@/audit";
import { DashboardReadModelService } from "@/dashboard/read-model";
import { DemoScenarioStore } from "@/dashboard/scenario-store";
import { createLocalDatabase } from "@/lib/db/client";
import { env } from "@/lib/env";
import { DemoReadModelService } from "@/orchestration/read-model";
import { RecoverAiDemoOrchestrator } from "@/orchestration/recovery-orchestrator";
import { PaymentStateReconciler } from "@/reconciliation";
import { createSqliteRepositories } from "@/repositories/sqlite";
import {
  SecureRazorpayWebhookIngestor,
  VerifiedWebhookAuditProcessor,
  VerifiedPaymentLinkWebhookProcessor,
  VerifiedWebhookReconciliationProcessor,
} from "@/webhooks";

let singleton: ReturnType<typeof createRuntime> | undefined;

function createRuntime() {
  const database = createLocalDatabase();
  const repositories = createSqliteRepositories(database);
  const audit = createSqliteAuditChain(database);
  const orchestrator = new RecoverAiDemoOrchestrator({ repositories, audit });
  const providerAdapter =
    env.APP_MODE === "razorpay_test"
      ? new RazorpayTestModeAdapter({
          transport: new NativeRazorpayTestModeTransport({
            keyId: env.RAZORPAY_TEST_KEY_ID!,
            keySecret: env.RAZORPAY_TEST_KEY_SECRET!,
          }),
          attemptBudget: new SqliteTestModeLinkAttemptBudget(database),
          writesEnabled: env.RECOVERAI_ALLOW_TEST_MODE_WRITES,
          verifyCaseBeforeCreate: (request) => {
            const current = repositories.recoveryCases.findById(
              request.caseReference,
            );
            return (
              current !== null &&
              current.state === request.expectedCaseState &&
              current.version === request.expectedCaseVersion &&
              current.paymentId === request.paymentId &&
              current.orderId === request.orderId &&
              current.verifiedUnpaidAmountSubunits === request.amountSubunits &&
              current.currency === request.currency
            );
          },
        })
      : new DeterministicMockRazorpayAdapter();
  const reconciler = new PaymentStateReconciler({
    adapter: providerAdapter,
    repositories,
    audit,
  });
  const webhookIngestor = new SecureRazorpayWebhookIngestor({
    repositories,
    processor: new VerifiedWebhookReconciliationProcessor(
      new VerifiedWebhookAuditProcessor(audit),
      reconciler,
      1_000,
      new VerifiedPaymentLinkWebhookProcessor(repositories, audit),
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
    providerAdapter,
  };
}

export function applicationRuntime() {
  singleton ??= createRuntime();
  return singleton;
}

export function demoRuntime() {
  return applicationRuntime();
}
