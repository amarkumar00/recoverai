import {
  aiScoringResultSchema,
  PROBABILITY_SCALE_MILLIONTHS,
  type AiScoringResult,
} from "@/ai/contracts";
import { createSafeFallback } from "@/ai/safe-fallback";
import type { RecoveryAction } from "@/domain/actions";
import type { FailureClass } from "@/domain/diagnosis";
import { DEFAULT_POLICY_CONFIG } from "@/policy/config";
import {
  policyEvaluationInputSchema,
  recoveryActionIntentSchema,
  type PolicyEvaluationInput,
  type RecoveryActionIntent,
} from "@/policy/contracts";
import { paymentLinkRecordSchema } from "@/repositories/contracts";

export const policyWindowStart = "2026-08-25T00:00:00.000Z";
export const policyWindowEnd = "2026-08-26T00:00:00.000Z";
export const policyEvaluationTime = "2026-08-25T12:00:00.000Z";

function diagnosisFor(action: RecoveryAction): {
  failureClass: FailureClass;
  knowledgeStatus: "KNOWN" | "AMBIGUOUS";
  candidateActions: RecoveryAction[];
} {
  switch (action) {
    case "WAIT_FOR_RECOVERY":
      return {
        failureClass: "DOWNTIME_OR_TRANSIENT",
        knowledgeStatus: "KNOWN",
        candidateActions: ["WAIT_FOR_RECOVERY", "ESCALATE_HUMAN"],
      };
    case "SEND_PAYMENT_LINK":
      return {
        failureClass: "CUSTOMER_CORRECTABLE",
        knowledgeStatus: "KNOWN",
        candidateActions: [
          "SEND_PAYMENT_LINK",
          "REQUEST_METHOD_CHANGE",
          "ESCALATE_HUMAN",
        ],
      };
    case "REQUEST_METHOD_CHANGE":
      return {
        failureClass: "INSUFFICIENT_FUNDS",
        knowledgeStatus: "KNOWN",
        candidateActions: [
          "REQUEST_METHOD_CHANGE",
          "SEND_PAYMENT_LINK",
          "ESCALATE_HUMAN",
        ],
      };
    case "CANCEL_RECOVERY_ALREADY_PAID":
      return {
        failureClass: "LATE_SUCCESS",
        knowledgeStatus: "KNOWN",
        candidateActions: ["CANCEL_RECOVERY_ALREADY_PAID"],
      };
    case "STOP_NON_RETRYABLE":
      return {
        failureClass: "NON_RETRYABLE",
        knowledgeStatus: "KNOWN",
        candidateActions: ["STOP_NON_RETRYABLE"],
      };
    case "ESCALATE_HUMAN":
      return {
        failureClass: "AMBIGUOUS",
        knowledgeStatus: "AMBIGUOUS",
        candidateActions: ["ESCALATE_HUMAN"],
      };
  }
}

function intentFor(action: RecoveryAction): RecoveryActionIntent {
  if (action === "SEND_PAYMENT_LINK" || action === "REQUEST_METHOD_CHANGE") {
    return recoveryActionIntentSchema.parse({
      action,
      orderId: "order_policy_001",
      intendedAmountSubunits: 100_000,
      intendedCurrency: "INR",
      linkUse: { mode: "CREATE_NEW" },
    });
  }
  return recoveryActionIntentSchema.parse({ action });
}

export function scoringResultFor(
  action: RecoveryAction,
  overrides: {
    confidence?: number;
    expectedValueSubunits?: number;
    currency?: string;
    breakdownAction?: RecoveryAction;
    contextStatus?: "SUFFICIENT" | "INSUFFICIENT";
  } = {},
): AiScoringResult {
  if (action === "ESCALATE_HUMAN") {
    return createSafeFallback(
      "case_policy_001",
      policyEvaluationTime,
      "INSUFFICIENT_CONTEXT",
    );
  }
  const probabilityMillionths =
    action === "STOP_NON_RETRYABLE" || action === "CANCEL_RECOVERY_ALREADY_PAID"
      ? 0
      : 800_000;
  const expectedRecoveredSubunits =
    (100_000 * probabilityMillionths) / PROBABILITY_SCALE_MILLIONTHS;
  const totalPenaltySubunits = 100;
  const expectedValueSubunits =
    overrides.expectedValueSubunits ??
    expectedRecoveredSubunits - totalPenaltySubunits;

  return aiScoringResultSchema.parse({
    status: "SUCCESS",
    recommendation: {
      caseId: "case_policy_001",
      rankedActions: [
        {
          rank: 1,
          action,
          recoveryProbability:
            probabilityMillionths / PROBABILITY_SCALE_MILLIONTHS,
          reason: "The bounded test recommendation selected this action.",
          evidence: [
            {
              code: "POLICY_TEST_ESTIMATE",
              detail: "A deterministic policy fixture supplied this estimate.",
            },
          ],
        },
      ],
      selectedAction: action,
      confidence: overrides.confidence ?? 0.8,
      merchantExplanation:
        "The selected action ranked first in the deterministic test fixture.",
      reason: "The selected bounded action ranked first.",
      evidence: [
        {
          code: "POLICY_TEST_ESTIMATE",
          detail: "A deterministic policy fixture supplied this estimate.",
        },
      ],
      contextStatus: overrides.contextStatus ?? "SUFFICIENT",
      escalationRecommended: false,
      recommendedAt: policyEvaluationTime,
    },
    scoreBreakdowns: [
      {
        action: overrides.breakdownAction ?? action,
        recoveryProbabilityMillionths: probabilityMillionths,
        expectedRecoveredSubunits,
        contactCostSubunits: 25,
        frictionPenaltySubunits: 25,
        duplicatePaymentRiskPenaltySubunits: 25,
        operationalCostSubunits: 25,
        totalPenaltySubunits,
        expectedValueSubunits,
        currency: overrides.currency ?? "INR",
      },
    ],
  });
}

export function policyInput(
  action: RecoveryAction = "WAIT_FOR_RECOVERY",
): PolicyEvaluationInput {
  const diagnosis = diagnosisFor(action);
  const isSatisfied = action === "CANCEL_RECOVERY_ALREADY_PAID";

  return policyEvaluationInputSchema.parse({
    caseRecord: {
      caseId: "case_policy_001",
      paymentId: "pay_policy_001",
      orderId: "order_policy_001",
      syntheticCustomerHash: "a".repeat(64),
      verifiedUnpaidAmountSubunits: 100_000,
      currency: "INR",
      state: "AWAITING_POLICY",
      attemptNumber: 1,
      previousSuccessCount: 0,
      previousFailureCount: 1,
      contactCount: 0,
      recoveryWindowStartsAt: policyWindowStart,
      recoveryWindowEndsAt: policyWindowEnd,
      version: 1,
      createdAt: policyWindowStart,
      updatedAt: policyEvaluationTime,
    },
    paymentContext: {
      caseId: "case_policy_001",
      paymentId: "pay_policy_001",
      orderId: "order_policy_001",
      syntheticCustomerHash: "a".repeat(64),
      money: { amountSubunits: 100_000, currency: "INR" },
      status: isSatisfied ? "CAPTURED" : "FAILED",
      method: "upi",
      failure: { errorCode: "BAD_REQUEST_ERROR" },
      attemptNumber: 1,
      previousSuccessCount: 0,
      previousFailureCount: 1,
      previousContactCount: 0,
      paymentCreatedAt: policyWindowStart,
      eventCreatedAt: policyEvaluationTime,
      currentReconciledState: {
        availability: "AVAILABLE",
        status: isSatisfied ? "CAPTURED" : "FAILED",
        fetchedAt: policyEvaluationTime,
      },
      activeRecoveryLink: { exists: false },
      downtimeContext: {
        availability: "AVAILABLE",
        active: action === "WAIT_FOR_RECOVERY",
        observedAt: policyEvaluationTime,
      },
    },
    paymentSatisfaction: isSatisfied
      ? {
          status: "SATISFIED",
          basis: "PAYMENT_CAPTURED",
          verifiedAt: policyEvaluationTime,
        }
      : {
          status: "UNSATISFIED",
          paymentStatus: "FAILED",
          verifiedAt: policyEvaluationTime,
        },
    diagnosis: {
      caseId: "case_policy_001",
      ...diagnosis,
      reason: "A deterministic diagnosis supplied the policy candidates.",
      evidence: [
        {
          code: "POLICY_TEST_DIAGNOSIS",
          detail: "The policy fixture contains trusted deterministic context.",
        },
      ],
      diagnosedAt: policyEvaluationTime,
    },
    aiScoringResult: scoringResultFor(action),
    intent: intentFor(action),
    totalPaymentLinksCreated: 0,
    paymentLinks: [],
    evaluatedAt: policyEvaluationTime,
    config: DEFAULT_POLICY_CONFIG,
  });
}

export function paymentLink(
  status:
    | "CREATED"
    | "PARTIALLY_PAID"
    | "PAID"
    | "CANCELLED"
    | "EXPIRED"
    | "FAILED_SAFE" = "CREATED",
) {
  return paymentLinkRecordSchema.parse({
    recoveryLinkId: `link_policy_${status.toLowerCase()}`,
    caseId: "case_policy_001",
    orderId: "order_policy_001",
    referenceId: `reference_policy_${status.toLowerCase()}`,
    amountSubunits: 100_000,
    currency: "INR",
    status,
    blocksCreation: status === "CREATED" || status === "PARTIALLY_PAID",
    createdAt: policyWindowStart,
    ...(status === "PAID" ? { paidAt: policyEvaluationTime } : {}),
    ...(status === "CANCELLED" ? { cancelledAt: policyEvaluationTime } : {}),
    updatedAt: policyEvaluationTime,
  });
}
