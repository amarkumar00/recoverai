export const canonicalTime = "2026-08-24T12:30:00.000Z";
export const syntheticCustomerHash = "a".repeat(64);
export const auditHash = "b".repeat(64);

export const validPaymentContext = {
  caseId: "case_demo_001",
  paymentId: "pay_demo_001",
  orderId: "order_demo_001",
  syntheticCustomerHash,
  money: { amountSubunits: 125_000, currency: "INR" },
  status: "FAILED",
  method: "upi",
  bankOrProvider: "synthetic_provider",
  failure: {
    errorCode: "BAD_REQUEST_ERROR",
    errorDescription: "Synthetic payment attempt failed.",
    errorSource: "bank",
    errorStep: "payment_authorization",
    errorReason: "payment_failed",
  },
  attemptNumber: 1,
  previousSuccessCount: 0,
  previousFailureCount: 1,
  previousContactCount: 0,
  paymentCreatedAt: canonicalTime,
  eventCreatedAt: canonicalTime,
  currentReconciledState: {
    availability: "AVAILABLE",
    status: "FAILED",
    fetchedAt: canonicalTime,
  },
  activeRecoveryLink: { exists: false },
  downtimeContext: {
    availability: "AVAILABLE",
    active: false,
    observedAt: canonicalTime,
  },
};

export const validExternalWebhook = {
  entity: "event",
  account_id: "acc_synthetic",
  event: "payment.failed",
  contains: ["payment"],
  payload: {
    payment: {
      entity: {
        id: "pay_demo_001",
        order_id: "order_demo_001",
        amount: 125_000,
        currency: "INR",
        status: "failed",
        method: "upi",
        bank: "synthetic_provider",
        wallet: null,
        error_code: "BAD_REQUEST_ERROR",
        error_description: "Synthetic payment attempt failed.",
        error_source: "bank",
        error_step: "payment_authorization",
        error_reason: "payment_failed",
        created_at: 1_777_032_600,
        provider_extension: "allowed-only-at-external-boundary",
      },
    },
  },
  created_at: 1_777_032_600,
  external_envelope_extension: true,
};

export const validNormalizedEvent = {
  eventId: "event_demo_001",
  eventName: "payment.failed",
  occurredAt: canonicalTime,
  receivedAt: canonicalTime,
  paymentId: "pay_demo_001",
  orderId: "order_demo_001",
  paymentSnapshot: {
    paymentId: "pay_demo_001",
    orderId: "order_demo_001",
    money: { amountSubunits: 125_000, currency: "INR" },
    status: "FAILED",
    method: "upi",
    failure: {
      errorCode: "BAD_REQUEST_ERROR",
    },
    paymentCreatedAt: canonicalTime,
  },
  signatureVerification: { status: "VERIFIED" },
  duplicateProcessing: { status: "FIRST_SEEN" },
};

export const validDiagnosis = {
  caseId: "case_demo_001",
  failureClass: "DOWNTIME_OR_TRANSIENT",
  knowledgeStatus: "KNOWN",
  reason: "Synthetic provider downtime evidence is available.",
  evidence: [
    {
      code: "DOWNTIME_ACTIVE",
      detail: "Synthetic downtime context reports an active incident.",
    },
  ],
  candidateActions: ["WAIT_FOR_RECOVERY", "ESCALATE_HUMAN"],
  diagnosedAt: canonicalTime,
};

export const validAiRecommendation = {
  caseId: "case_demo_001",
  rankedActions: [
    {
      rank: 1,
      action: "WAIT_FOR_RECOVERY",
      recoveryProbability: 0.82,
      reason: "Temporary synthetic downtime is likely to clear.",
      evidence: [
        {
          code: "DOWNTIME_ACTIVE",
          detail: "Synthetic downtime context reports an active incident.",
        },
      ],
    },
    {
      rank: 2,
      action: "ESCALATE_HUMAN",
      recoveryProbability: 0.25,
      reason: "Human review is the conservative fallback.",
      evidence: [
        {
          code: "SAFE_FALLBACK",
          detail: "Escalation does not authorize a money action.",
        },
      ],
    },
  ],
  selectedAction: "WAIT_FOR_RECOVERY",
  confidence: 0.88,
  merchantExplanation: "Wait for the synthetic incident to clear.",
  customerSafeMessage: "Please try again after a short wait.",
  reason: "The highest-ranked bounded action is to wait.",
  evidence: [
    {
      code: "DOWNTIME_ACTIVE",
      detail: "Synthetic downtime context reports an active incident.",
    },
  ],
  contextStatus: "SUFFICIENT",
  escalationRecommended: false,
  recommendedAt: canonicalTime,
};

export const validPolicyDecision = {
  caseId: "case_demo_001",
  proposedAction: "WAIT_FOR_RECOVERY",
  finalAction: "WAIT_FOR_RECOVERY",
  outcome: "APPROVED",
  ruleId: "DOWNTIME_WAIT_ALLOWED",
  reason: "The proposed action does not create a money movement.",
  checksPerformed: [
    {
      ruleId: "DOWNTIME_WAIT_ALLOWED",
      status: "PASSED",
      reason: "The reconciled synthetic payment remains failed.",
    },
  ],
  caseState: "AWAITING_POLICY",
  decidedAt: canonicalTime,
};

export const validAuditEntry = {
  sequence: 1,
  entryId: "audit_demo_001",
  timestamp: canonicalTime,
  actor: "POLICY_FIREWALL",
  inputReference: "case_demo_001",
  eventType: "ACTION_APPROVED",
  reason: "The passive policy decision contract validated.",
  previousState: "AWAITING_POLICY",
  newState: "WAITING",
  previousHash: null,
  currentHash: auditHash,
  metadata: {
    caseId: "case_demo_001",
    action: "WAIT_FOR_RECOVERY",
    confidence: 0.88,
    checkCount: 1,
    isSynthetic: true,
  },
};

export const validSimulatedEvaluation = {
  evaluationRunId: "eval_demo_001",
  seed: "RECOVERAI-HELD-OUT-001",
  completedAt: canonicalTime,
  uniqueCaseCount: 100,
  eventDeliveryCount: 125,
  simulatedRevenueInitiallyAtRisk: {
    amountSubunits: 84_250_000,
    currency: "INR",
  },
  baselineSimulatedRecovery: {
    amountSubunits: 24_850_000,
    currency: "INR",
  },
  recoverAiSimulatedRecovery: {
    amountSubunits: 36_775_000,
    currency: "INR",
  },
  incrementalSimulatedRecovery: {
    subunitDelta: 11_925_000,
    currency: "INR",
  },
  simulatedRecoveryRate: 0.436,
  rootCauseAccuracy: 0.91,
  actionSelectionAccuracy: 0.87,
  unsafeActionsBlocked: 7,
  duplicateEventsIgnored: 18,
  duplicateChargeAttemptsPrevented: 4,
  customerContactsAvoided: 21,
  humanEscalationRate: 0.05,
  falsePositiveInterventionCostSimulated: {
    amountSubunits: 50_000,
    currency: "INR",
  },
  paymentLinkCreationCount: 28,
  apiFallbackOrFailureCount: 3,
  meanProcessingTimeMilliseconds: 42.5,
  unresolvedExceptionCount: 5,
  confusionMatrix: [
    {
      actualFailureClass: "DOWNTIME_OR_TRANSIENT",
      predictedFailureClass: "DOWNTIME_OR_TRANSIENT",
      caseCount: 23,
    },
  ],
  resultsByFailureClass: [
    {
      failureClass: "DOWNTIME_OR_TRANSIENT",
      uniqueCaseCount: 25,
      simulatedRevenueAtRisk: {
        amountSubunits: 20_000_000,
        currency: "INR",
      },
      simulatedRevenueRecovered: {
        amountSubunits: 12_000_000,
        currency: "INR",
      },
      simulatedRecoveryRate: 0.6,
      rootCauseAccuracy: 0.92,
      actionSelectionAccuracy: 0.88,
      unresolvedExceptionCount: 1,
    },
  ],
  resultsBySelectedAction: [
    {
      selectedAction: "WAIT_FOR_RECOVERY",
      caseCount: 25,
      simulatedRevenueRecovered: {
        amountSubunits: 12_000_000,
        currency: "INR",
      },
      simulatedRecoveryRate: 0.6,
    },
  ],
};
