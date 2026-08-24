import {
  aiProviderOutputSchema,
  aiScorerInputSchema,
  type AiProviderOutput,
  type AiScorerInput,
} from "@/ai/contracts";
import type { RecoveryAction } from "@/domain/actions";

export const scoringTime = "2026-08-25T14:30:00.000Z";

const zeroPenalty = {
  contactCostSubunits: 0,
  frictionPenaltySubunits: 0,
  duplicatePaymentRiskPenaltySubunits: 0,
  operationalCostSubunits: 0,
};

export const defaultScoringConfig = {
  providerTimeoutMilliseconds: 100,
  actionPenalties: {
    WAIT_FOR_RECOVERY: {
      ...zeroPenalty,
      operationalCostSubunits: 50,
    },
    SEND_PAYMENT_LINK: {
      contactCostSubunits: 200,
      frictionPenaltySubunits: 300,
      duplicatePaymentRiskPenaltySubunits: 400,
      operationalCostSubunits: 100,
    },
    REQUEST_METHOD_CHANGE: {
      contactCostSubunits: 200,
      frictionPenaltySubunits: 350,
      duplicatePaymentRiskPenaltySubunits: 200,
      operationalCostSubunits: 120,
    },
    CANCEL_RECOVERY_ALREADY_PAID: {
      ...zeroPenalty,
      operationalCostSubunits: 20,
    },
    STOP_NON_RETRYABLE: {
      ...zeroPenalty,
      operationalCostSubunits: 30,
    },
    ESCALATE_HUMAN: {
      ...zeroPenalty,
      operationalCostSubunits: 500,
    },
  },
};

export function scorerInput(
  overrides: {
    seed?: string;
    recommendedAt?: string;
    amountSubunits?: number;
    currency?: string;
    previousContactCount?: number;
    activeRecoveryLink?:
      { exists: false } | { exists: true; recoveryLinkId: string };
    failureClass?:
      | "DOWNTIME_OR_TRANSIENT"
      | "INSUFFICIENT_FUNDS"
      | "CUSTOMER_CORRECTABLE"
      | "NETWORK_OR_INTEGRATION_UNCERTAINTY"
      | "LATE_SUCCESS"
      | "NON_RETRYABLE"
      | "AMBIGUOUS";
    knowledgeStatus?: "KNOWN" | "AMBIGUOUS" | "UNAVAILABLE";
    candidateActions?: RecoveryAction[];
    scoringConfig?: typeof defaultScoringConfig;
  } = {},
): AiScorerInput {
  const failureClass = overrides.failureClass ?? "CUSTOMER_CORRECTABLE";
  const candidateActions = overrides.candidateActions ?? [
    "SEND_PAYMENT_LINK",
    "REQUEST_METHOD_CHANGE",
    "ESCALATE_HUMAN",
  ];

  return aiScorerInputSchema.parse({
    caseId: "case_ai_001",
    seed: overrides.seed ?? "RECOVERAI-MOCK-001",
    recommendedAt: overrides.recommendedAt ?? scoringTime,
    paymentContext: {
      caseId: "case_ai_001",
      paymentId: "pay_ai_001",
      orderId: "order_ai_001",
      syntheticCustomerHash: "a".repeat(64),
      money: {
        amountSubunits: overrides.amountSubunits ?? 100_000,
        currency: overrides.currency ?? "INR",
      },
      status: "FAILED",
      method: "upi",
      failure: {
        errorCode: "BAD_REQUEST_ERROR",
        errorReason: "incorrect_otp",
      },
      attemptNumber: 1,
      previousSuccessCount: 0,
      previousFailureCount: 1,
      previousContactCount: overrides.previousContactCount ?? 0,
      paymentCreatedAt: scoringTime,
      eventCreatedAt: scoringTime,
      currentReconciledState: {
        availability: "AVAILABLE",
        status: "FAILED",
        fetchedAt: scoringTime,
      },
      activeRecoveryLink: overrides.activeRecoveryLink ?? { exists: false },
      downtimeContext: {
        availability: "AVAILABLE",
        active: failureClass === "DOWNTIME_OR_TRANSIENT",
        observedAt: scoringTime,
      },
    },
    diagnosis: {
      caseId: "case_ai_001",
      failureClass,
      knowledgeStatus: overrides.knowledgeStatus ?? "KNOWN",
      reason: "A deterministic diagnosis supplied the candidate set.",
      evidence: [
        {
          code: "DETERMINISTIC_DIAGNOSIS",
          detail: "The test fixture contains no hidden outcome data.",
        },
      ],
      candidateActions,
      diagnosedAt: scoringTime,
    },
    scoringConfig: overrides.scoringConfig ?? defaultScoringConfig,
  });
}

export function providerOutput(
  estimates: Array<{
    action: RecoveryAction;
    recoveryProbabilityMillionths: number;
  }> = [
    { action: "SEND_PAYMENT_LINK", recoveryProbabilityMillionths: 640_000 },
    {
      action: "REQUEST_METHOD_CHANGE",
      recoveryProbabilityMillionths: 570_000,
    },
    { action: "ESCALATE_HUMAN", recoveryProbabilityMillionths: 80_000 },
  ],
): AiProviderOutput {
  return aiProviderOutputSchema.parse({
    estimates: estimates.map((estimate) => ({
      ...estimate,
      reason: `A bounded estimate supports ${estimate.action}.`,
      evidence: [
        {
          code: "MOCK_ESTIMATE",
          detail: "A controlled provider supplied this test estimate.",
        },
      ],
    })),
    confidenceMillionths: 820_000,
    merchantExplanation:
      "The provider estimated probabilities for diagnosis candidates only.",
    customerSafeMessage:
      "Please review your payment details or use another available payment method.",
    contextStatus: "SUFFICIENT",
    escalationRecommended: false,
  });
}
