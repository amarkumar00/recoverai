import { createHash } from "node:crypto";

import { canonicalizeJson } from "@/audit";
import type { RecoveryExecutionCommand } from "@/recovery/execution-contracts";

export const RECOVERY_EXECUTION_IDENTIFIER_VERSION =
  "recoverai_exec_v1" as const;

function identifier(kind: string, semanticInput: unknown) {
  const digest = createHash("sha256")
    .update(
      `${RECOVERY_EXECUTION_IDENTIFIER_VERSION}:${kind}:${canonicalizeJson(semanticInput)}`,
    )
    .digest("hex")
    .slice(0, 24);
  return `ra_v1_${kind}_${digest}`;
}

export function executionIdentifiers(command: RecoveryExecutionCommand) {
  const semantic = {
    caseId: command.caseRecord.caseId,
    decisionAt: command.decision.decidedAt,
    proposedAction: command.decision.proposedAction,
    finalAction: command.decision.finalAction ?? null,
    intent: command.intent,
  };
  return {
    actionRecordId: identifier("action", semantic),
    idempotencyKey: identifier("idem", semantic),
    paymentLinkReferenceId: identifier("plinkref", {
      caseId: command.caseRecord.caseId,
      orderId: command.caseRecord.orderId,
      action: command.decision.finalAction ?? null,
    }),
    recoveryLinkId: identifier("link", {
      caseId: command.caseRecord.caseId,
      orderId: command.caseRecord.orderId,
    }),
    auditEntryId(stage: string) {
      return identifier("audit", { action: semantic, stage });
    },
  };
}
