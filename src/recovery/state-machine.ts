import type { RecoveryCaseState } from "@/domain/states";
import {
  recoveryCaseTransitionContextSchema,
  recoveryCaseTransitionResultSchema,
  type RecoveryCaseTransitionContext,
  type RecoveryCaseTransitionResult,
} from "@/recovery/transition-contracts";

export const ACTIVE_RECOVERY_STATES = [
  "DETECTED",
  "VERIFYING",
  "DIAGNOSED",
  "AWAITING_POLICY",
  "WAITING",
  "LINK_CREATED",
] as const satisfies readonly RecoveryCaseState[];

export const TERMINAL_RECOVERY_STATES = [
  "RECOVERED",
  "STOPPED",
  "ESCALATED",
  "ERROR_SAFE",
] as const satisfies readonly RecoveryCaseState[];

export const SAFE_STOPPING_STATES = [
  "RECOVERED",
  "STOPPED",
  "ESCALATED",
  "ERROR_SAFE",
] as const satisfies readonly RecoveryCaseState[];

export const LEGAL_RECOVERY_TRANSITIONS = {
  DETECTED: ["VERIFYING", "RECOVERED", "STOPPED", "ESCALATED", "ERROR_SAFE"],
  VERIFYING: ["DIAGNOSED", "RECOVERED", "STOPPED", "ESCALATED", "ERROR_SAFE"],
  DIAGNOSED: [
    "AWAITING_POLICY",
    "RECOVERED",
    "STOPPED",
    "ESCALATED",
    "ERROR_SAFE",
  ],
  AWAITING_POLICY: [
    "WAITING",
    "LINK_CREATED",
    "RECOVERED",
    "STOPPED",
    "ESCALATED",
    "ERROR_SAFE",
  ],
  WAITING: ["VERIFYING", "RECOVERED", "STOPPED", "ESCALATED", "ERROR_SAFE"],
  LINK_CREATED: ["RECOVERED", "STOPPED", "ESCALATED", "ERROR_SAFE"],
  RECOVERED: [],
  STOPPED: [],
  ESCALATED: [],
  ERROR_SAFE: [],
} as const satisfies Record<RecoveryCaseState, readonly RecoveryCaseState[]>;

const activeStates = new Set<RecoveryCaseState>(ACTIVE_RECOVERY_STATES);
const terminalStates = new Set<RecoveryCaseState>(TERMINAL_RECOVERY_STATES);

function decide(
  context: RecoveryCaseTransitionContext,
  values: Pick<
    RecoveryCaseTransitionResult,
    | "status"
    | "decisionReasonCode"
    | "reason"
    | "resultingState"
    | "resultingVersion"
  >,
  evidenceCode: string,
  evidenceDetail: string,
): RecoveryCaseTransitionResult {
  const { command, actualCurrentState, actualVersion } = context;
  return recoveryCaseTransitionResultSchema.parse({
    caseId: command.caseId,
    previousState: actualCurrentState,
    requestedState: command.requestedState,
    previousVersion: actualVersion,
    requestReasonCode: command.reasonCode,
    decidedAt: command.transitionedAt,
    evidence: [{ code: evidenceCode, detail: evidenceDetail }],
    ...values,
  });
}

export function decideRecoveryCaseTransition(
  rawContext: RecoveryCaseTransitionContext,
): RecoveryCaseTransitionResult {
  const context = recoveryCaseTransitionContextSchema.parse(rawContext);
  const { command, actualCurrentState, actualVersion } = context;
  const { requestedState, paymentSatisfaction } = command;

  if (actualVersion !== command.expectedVersion) {
    return decide(
      context,
      {
        status: "VERSION_CONFLICT",
        decisionReasonCode: "EXPECTED_VERSION_MISMATCH",
        reason:
          "The persisted case version does not match the expected version.",
        resultingState: actualCurrentState,
        resultingVersion: actualVersion,
      },
      "PERSISTED_VERSION_OBSERVED",
      "The transition was rejected before any state mutation.",
    );
  }

  if (actualCurrentState !== command.expectedCurrentState) {
    return decide(
      context,
      {
        status: "CURRENT_STATE_MISMATCH",
        decisionReasonCode: "EXPECTED_STATE_MISMATCH",
        reason: "The persisted case state does not match the expected state.",
        resultingState: actualCurrentState,
        resultingVersion: actualVersion,
      },
      "PERSISTED_STATE_OBSERVED",
      "The transition was rejected before any state mutation.",
    );
  }

  if (
    requestedState === actualCurrentState &&
    terminalStates.has(actualCurrentState)
  ) {
    return decide(
      context,
      {
        status: "IDEMPOTENT_NO_OP",
        decisionReasonCode: "SAME_STATE_NO_OP",
        reason:
          "The requested state is already persisted; no mutation is needed.",
        resultingState: actualCurrentState,
        resultingVersion: actualVersion,
      },
      "STATE_ALREADY_CURRENT",
      "The persisted terminal state and version remain unchanged.",
    );
  }

  if (paymentSatisfaction.status === "SATISFIED") {
    if (requestedState !== "RECOVERED" && requestedState !== "STOPPED") {
      return decide(
        context,
        {
          status: "PAID_STATE_SAFETY_REJECTION",
          decisionReasonCode: "SATISFIED_PAYMENT_REQUIRES_SAFE_STOP",
          reason:
            "A verified satisfied payment can only move to a recovered or stopped state.",
          resultingState: actualCurrentState,
          resultingVersion: actualVersion,
        },
        "PAYMENT_SATISFACTION_VERIFIED",
        `Verified satisfaction basis: ${paymentSatisfaction.basis}.`,
      );
    }
  } else if (requestedState === "RECOVERED") {
    return decide(
      context,
      {
        status: "PAYMENT_CONTEXT_REJECTION",
        decisionReasonCode: "RECOVERY_REQUIRES_VERIFIED_SATISFACTION",
        reason:
          "A case cannot be marked recovered without verified payment satisfaction.",
        resultingState: actualCurrentState,
        resultingVersion: actualVersion,
      },
      "PAYMENT_SATISFACTION_NOT_VERIFIED",
      "The trusted payment context did not confirm payment satisfaction.",
    );
  }

  if (
    activeStates.has(requestedState) &&
    paymentSatisfaction.status !== "UNSATISFIED"
  ) {
    return decide(
      context,
      {
        status: "PAYMENT_CONTEXT_REJECTION",
        decisionReasonCode: "ACTIVE_RECOVERY_REQUIRES_VERIFIED_UNPAID_STATE",
        reason: "Active recovery requires a verified unpaid payment state.",
        resultingState: actualCurrentState,
        resultingVersion: actualVersion,
      },
      "PAYMENT_CONTEXT_NOT_UNPAID",
      "Unavailable, conflicting, or satisfied context cannot activate recovery.",
    );
  }

  if (requestedState === actualCurrentState) {
    return decide(
      context,
      {
        status: "IDEMPOTENT_NO_OP",
        decisionReasonCode: "SAME_STATE_NO_OP",
        reason:
          "The requested state is already persisted; no mutation is needed.",
        resultingState: actualCurrentState,
        resultingVersion: actualVersion,
      },
      "STATE_ALREADY_CURRENT",
      "The persisted state and version remain unchanged.",
    );
  }

  if (terminalStates.has(actualCurrentState)) {
    return decide(
      context,
      {
        status: "TERMINAL_STATE_REJECTION",
        decisionReasonCode: "TERMINAL_STATE_IMMUTABLE",
        reason: "Terminal recovery cases cannot transition to another state.",
        resultingState: actualCurrentState,
        resultingVersion: actualVersion,
      },
      "TERMINAL_STATE_OBSERVED",
      `The persisted ${actualCurrentState} state is terminal for the MVP.`,
    );
  }

  const legalTargets = LEGAL_RECOVERY_TRANSITIONS[actualCurrentState];
  if (
    !(legalTargets as readonly RecoveryCaseState[]).includes(requestedState)
  ) {
    return decide(
      context,
      {
        status: "ILLEGAL_TRANSITION",
        decisionReasonCode: "ILLEGAL_STATE_EDGE",
        reason:
          "The requested state edge is not part of the legal transition map.",
        resultingState: actualCurrentState,
        resultingVersion: actualVersion,
      },
      "LEGAL_TARGETS_EVALUATED",
      "No matching legal transition edge was found.",
    );
  }

  return decide(
    context,
    {
      status: "APPLIED",
      decisionReasonCode: "TRANSITION_APPROVED",
      reason: command.reason,
      resultingState: requestedState,
      resultingVersion: actualVersion + 1,
    },
    "LEGAL_TRANSITION_CONFIRMED",
    `The ${actualCurrentState} to ${requestedState} edge is explicitly allowed.`,
  );
}
