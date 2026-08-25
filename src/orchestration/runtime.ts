import "server-only";

import { createSqliteAuditChain } from "@/audit";
import { createLocalDatabase } from "@/lib/db/client";
import { DemoReadModelService } from "@/orchestration/read-model";
import { RecoverAiDemoOrchestrator } from "@/orchestration/recovery-orchestrator";
import { createSqliteRepositories } from "@/repositories/sqlite";
import {
  SecureRazorpayWebhookIngestor,
  VerifiedWebhookAuditProcessor,
} from "@/webhooks";

let singleton: ReturnType<typeof createRuntime> | undefined;

function createRuntime() {
  const database = createLocalDatabase();
  const repositories = createSqliteRepositories(database);
  const audit = createSqliteAuditChain(database);
  const orchestrator = new RecoverAiDemoOrchestrator({ repositories, audit });
  const webhookIngestor = new SecureRazorpayWebhookIngestor({
    repositories,
    processor: new VerifiedWebhookAuditProcessor(audit),
  });
  const readModel = new DemoReadModelService({
    repositories,
    audit,
    orchestrator,
  });
  return {
    database,
    repositories,
    audit,
    orchestrator,
    readModel,
    webhookIngestor,
  };
}

export function applicationRuntime() {
  singleton ??= createRuntime();
  return singleton;
}

export function demoRuntime() {
  return applicationRuntime();
}
