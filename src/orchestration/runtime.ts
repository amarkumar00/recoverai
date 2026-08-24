import "server-only";

import { createSqliteAuditChain } from "@/audit";
import { createLocalDatabase } from "@/lib/db/client";
import { DemoReadModelService } from "@/orchestration/read-model";
import { RecoverAiDemoOrchestrator } from "@/orchestration/recovery-orchestrator";
import { createSqliteRepositories } from "@/repositories/sqlite";

let singleton: ReturnType<typeof createRuntime> | undefined;

function createRuntime() {
  const database = createLocalDatabase();
  const repositories = createSqliteRepositories(database);
  const audit = createSqliteAuditChain(database);
  const orchestrator = new RecoverAiDemoOrchestrator({ repositories, audit });
  const readModel = new DemoReadModelService({
    repositories,
    audit,
    orchestrator,
  });
  return { database, repositories, audit, orchestrator, readModel };
}

export function demoRuntime() {
  singleton ??= createRuntime();
  return singleton;
}
