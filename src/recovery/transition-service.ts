import type { RecoveryCaseRepository } from "@/repositories/interfaces";
import { decideRecoveryCaseTransition } from "@/recovery/state-machine";
import {
  recoveryCaseTransitionCommandSchema,
  recoveryCaseTransitionResultSchema,
  type RecoveryCaseTransitionCommand,
  type RecoveryCaseTransitionResult,
} from "@/recovery/transition-contracts";

export function transitionRecoveryCase(
  repository: RecoveryCaseRepository,
  rawCommand: RecoveryCaseTransitionCommand,
): RecoveryCaseTransitionResult {
  const command = recoveryCaseTransitionCommandSchema.parse(rawCommand);
  const recoveryCase = repository.findById(command.caseId);

  if (recoveryCase === null) {
    return recoveryCaseTransitionResultSchema.parse({
      status: "CASE_NOT_FOUND",
      caseId: command.caseId,
      previousState: null,
      requestedState: command.requestedState,
      resultingState: null,
      previousVersion: null,
      resultingVersion: null,
      decisionReasonCode: "CASE_NOT_FOUND",
      requestReasonCode: command.reasonCode,
      reason: "No recovery case exists for the supplied case identifier.",
      evidence: [
        {
          code: "CASE_LOOKUP_EMPTY",
          detail: "The repository returned no matching recovery case.",
        },
      ],
      decidedAt: command.transitionedAt,
    });
  }

  const decision = decideRecoveryCaseTransition({
    command,
    actualCurrentState: recoveryCase.state,
    actualVersion: recoveryCase.version,
  });

  if (decision.status !== "APPLIED") {
    return decision;
  }

  const persisted = repository.updateIfVersionMatches({
    caseId: command.caseId,
    expectedVersion: recoveryCase.version,
    state: command.requestedState,
    updatedAt: command.transitionedAt,
  });

  if (persisted.status === "VERSION_MISMATCH") {
    return recoveryCaseTransitionResultSchema.parse({
      status: "VERSION_CONFLICT",
      caseId: command.caseId,
      previousState: recoveryCase.state,
      requestedState: command.requestedState,
      resultingState: persisted.recoveryCase?.state ?? recoveryCase.state,
      previousVersion: recoveryCase.version,
      resultingVersion: persisted.recoveryCase?.version ?? recoveryCase.version,
      decisionReasonCode: "PERSISTENCE_VERSION_CONFLICT",
      requestReasonCode: command.reasonCode,
      reason:
        "Another writer changed the case before the approved transition was persisted.",
      evidence: [
        {
          code: "OPTIMISTIC_UPDATE_LOST",
          detail: "The version-aware repository update changed no record.",
        },
      ],
      decidedAt: command.transitionedAt,
    });
  }

  return recoveryCaseTransitionResultSchema.parse({
    ...decision,
    resultingState: persisted.recoveryCase.state,
    resultingVersion: persisted.recoveryCase.version,
  });
}
