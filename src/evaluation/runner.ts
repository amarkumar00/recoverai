import { createHash } from "node:crypto";

import { DeterministicMockAiProvider } from "@/ai/mock-provider";
import { scoreRecoveryRecommendation } from "@/ai/recommendation-service";
import { canonicalizeJson } from "@/audit/canonical-json";
import { RECOVERY_ACTIONS, type RecoveryAction } from "@/domain/actions";
import { FAILURE_CLASSES, type FailureClass } from "@/domain/diagnosis";
import {
  simulatedEvaluationResultSchema,
  type SimulatedEvaluationResult,
} from "@/domain/evaluation";
import { diagnoseKnownPaymentFailure } from "@/diagnosis";
import {
  DIGITAL_TWIN_DATASET_VERSION,
  DIGITAL_TWIN_DISTRIBUTION,
  LOCKED_DEFAULT_HELD_OUT_FINGERPRINT_SHA256,
  digitalTwinSelectionBatchSchema,
  type DigitalTwinSelectionBatch,
  type ScorerVisibleDigitalTwinCase,
} from "@/digital-twin/contracts";
import type { RevealedSelectedOutcome } from "@/digital-twin/evaluator-only";
import {
  checkedAddNonnegativeSubunits,
  checkedSubtractSubunits,
} from "@/evaluation/arithmetic";
import { selectCanonicalBaselineAction } from "@/evaluation/baseline";
import {
  BASELINE_POLICY_VERSION,
  BASELINE_WAIT_MILLISECONDS,
  EVALUATION_COMPLETED_AT,
  EVALUATION_POLICY_VERSION,
  PROCESSING_TIME_MODEL,
  evaluationConfigurationSchema,
  type BaselineSelection,
  type EvaluationConfiguration,
} from "@/evaluation/contracts";
import { DEFAULT_POLICY_CONFIG } from "@/policy/config";
import type { RecoveryActionIntent } from "@/policy/contracts";
import { evaluateRecoveryPolicy } from "@/policy/firewall";
import {
  paymentLinkRecordSchema,
  recoveryCaseRecordSchema,
  type PaymentLinkRecord,
} from "@/repositories/contracts";

const EXPECTED_CASE_COUNT = 100;
const EXPECTED_UNIQUE_EVENT_COUNT = 112;
const EXPECTED_DELIVERY_COUNT = 125;
const EXPECTED_DUPLICATE_COUNT = 13;

const ZERO_PENALTY = {
  contactCostSubunits: 0,
  frictionPenaltySubunits: 0,
  duplicatePaymentRiskPenaltySubunits: 0,
  operationalCostSubunits: 0,
};

export const DEFAULT_EVALUATION_CONFIGURATION: EvaluationConfiguration =
  Object.freeze(
    evaluationConfigurationSchema.parse({
      evaluationPolicyVersion: EVALUATION_POLICY_VERSION,
      baselinePolicyVersion: BASELINE_POLICY_VERSION,
      completedAt: EVALUATION_COMPLETED_AT,
      scoringConfig: {
        providerTimeoutMilliseconds: 1_000,
        actionPenalties: {
          WAIT_FOR_RECOVERY: {
            ...ZERO_PENALTY,
            frictionPenaltySubunits: 100,
            duplicatePaymentRiskPenaltySubunits: 100,
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
            ...ZERO_PENALTY,
            operationalCostSubunits: 20,
          },
          STOP_NON_RETRYABLE: {
            ...ZERO_PENALTY,
            operationalCostSubunits: 30,
          },
          ESCALATE_HUMAN: {
            ...ZERO_PENALTY,
            operationalCostSubunits: 500,
          },
        },
      },
      policyConfig: DEFAULT_POLICY_CONFIG,
    }),
  );

export type SelectedOutcomeOracle = {
  revealSelectedOutcome(input: {
    caseId: ScorerVisibleDigitalTwinCase["caseId"];
    selectedAction: RecoveryAction;
    selectedAt: string;
  }): RevealedSelectedOutcome;
};

type StrategyTrace = {
  caseId: ScorerVisibleDigitalTwinCase["caseId"];
  predictedFailureClass: FailureClass;
  selectedAction: RecoveryAction;
  proposedAction: RecoveryAction;
  scoringFallback: boolean;
  policyInvalid: boolean;
  safetyRedirectedOrBlocked: boolean;
  duplicateChargeAttemptPrevented: boolean;
  createsPaymentLink: boolean;
  policyRuleId: string;
  revealed: RevealedSelectedOutcome;
};

type BaselineTrace = {
  selection: BaselineSelection;
  revealed: RevealedSelectedOutcome;
};

function checkedRunIdentity(
  batch: DigitalTwinSelectionBatch,
  configuration: EvaluationConfiguration,
): string {
  const identity = canonicalizeJson({
    datasetVersion: batch.datasetVersion,
    seed: batch.seed,
    fingerprintSha256: batch.manifest.fingerprintSha256,
    evaluationPolicyVersion: configuration.evaluationPolicyVersion,
    baselinePolicyVersion: configuration.baselinePolicyVersion,
    completedAt: configuration.completedAt,
    scoringConfig: configuration.scoringConfig,
    policyConfig: configuration.policyConfig,
  });
  return `eval_${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
}

function assertLockedHeldOutBatch(batch: DigitalTwinSelectionBatch): void {
  const manifest = batch.manifest;
  if (
    batch.datasetVersion !== DIGITAL_TWIN_DATASET_VERSION ||
    batch.datasetKind !== "HELD_OUT" ||
    manifest.fingerprintSha256 !== LOCKED_DEFAULT_HELD_OUT_FINGERPRINT_SHA256 ||
    manifest.uniquePaymentCount !== EXPECTED_CASE_COUNT ||
    manifest.uniqueProviderEventCount !== EXPECTED_UNIQUE_EVENT_COUNT ||
    manifest.deliveryCount !== EXPECTED_DELIVERY_COUNT ||
    manifest.duplicateDeliveryCount !== EXPECTED_DUPLICATE_COUNT ||
    canonicalizeJson(manifest.distribution) !==
      canonicalizeJson(DIGITAL_TWIN_DISTRIBUTION)
  ) {
    throw new Error(
      "Held-out evaluation batch does not match the approved locked Digital Twin.",
    );
  }
  if (
    batch.cases.length !== EXPECTED_CASE_COUNT ||
    batch.deliveries.length !== EXPECTED_DELIVERY_COUNT ||
    new Set(batch.cases.map(({ caseId }) => caseId)).size !==
      EXPECTED_CASE_COUNT ||
    new Set(batch.deliveries.map(({ providerEventId }) => providerEventId))
      .size !== EXPECTED_UNIQUE_EVENT_COUNT
  ) {
    throw new Error("Held-out evaluation replay counts are inconsistent.");
  }
}

function decisionAtFor(visibleCase: ScorerVisibleDigitalTwinCase): string {
  return new Date(
    Date.parse(visibleCase.paymentContext.eventCreatedAt) +
      BASELINE_WAIT_MILLISECONDS,
  ).toISOString();
}

function baselineInput(visibleCase: ScorerVisibleDigitalTwinCase) {
  const context = visibleCase.paymentContext;
  return {
    caseId: visibleCase.caseId,
    paymentId: context.paymentId,
    orderId: context.orderId,
    money: context.money,
    failureObservedAt: context.eventCreatedAt,
    decisionAt: decisionAtFor(visibleCase),
    paymentSatisfaction: visibleCase.paymentSatisfaction,
    currentReconciledState: context.currentReconciledState,
    activeRecoveryLink: context.activeRecoveryLink,
  };
}

function activeLinkFixture(
  visibleCase: ScorerVisibleDigitalTwinCase,
): PaymentLinkRecord[] {
  const activeLink = visibleCase.paymentContext.activeRecoveryLink;
  if (!activeLink.exists) return [];
  const createdAt = visibleCase.paymentContext.eventCreatedAt;
  return [
    paymentLinkRecordSchema.parse({
      recoveryLinkId: activeLink.recoveryLinkId,
      externalLinkId: `synthetic_external_${visibleCase.caseId}`,
      caseId: visibleCase.caseId,
      orderId: visibleCase.paymentContext.orderId,
      referenceId: `synthetic_reference_${visibleCase.caseId}`,
      amountSubunits: visibleCase.paymentContext.money.amountSubunits,
      currency: visibleCase.paymentContext.money.currency,
      status: "CREATED",
      blocksCreation: true,
      createdAt,
      expiresAt: new Date(
        Date.parse(createdAt) + 24 * 60 * 60 * 1_000,
      ).toISOString(),
      updatedAt: createdAt,
    }),
  ];
}

function actionIntent(
  action: RecoveryAction,
  visibleCase: ScorerVisibleDigitalTwinCase,
): RecoveryActionIntent {
  const context = visibleCase.paymentContext;
  if (action === "SEND_PAYMENT_LINK" || action === "REQUEST_METHOD_CHANGE") {
    return {
      action,
      orderId: context.orderId,
      intendedAmountSubunits: context.money.amountSubunits,
      intendedCurrency: context.money.currency,
      linkUse: context.activeRecoveryLink.exists
        ? {
            mode: "USE_EXISTING",
            recoveryLinkId: context.activeRecoveryLink.recoveryLinkId,
          }
        : { mode: "CREATE_NEW" },
    };
  }
  if (action === "CANCEL_RECOVERY_ALREADY_PAID") {
    return context.activeRecoveryLink.exists
      ? { action, recoveryLinkId: context.activeRecoveryLink.recoveryLinkId }
      : { action };
  }
  return { action };
}

async function evaluateRecoverAiCase(
  visibleCase: ScorerVisibleDigitalTwinCase,
  oracle: SelectedOutcomeOracle,
  configuration: EvaluationConfiguration,
  scorerSeed: string,
): Promise<StrategyTrace> {
  const decisionAt = decisionAtFor(visibleCase);
  const failureSnapshot =
    visibleCase.logicalEvents[0]?.normalizedEvent.paymentSnapshot;
  if (failureSnapshot === undefined) {
    throw new Error("Evaluation case is missing its failed-payment snapshot.");
  }
  const diagnosis = diagnoseKnownPaymentFailure({
    caseId: visibleCase.caseId,
    paymentSnapshot: failureSnapshot,
    paymentSatisfaction: visibleCase.paymentSatisfaction,
    downtimeContext: visibleCase.paymentContext.downtimeContext,
    activeRecoveryLink: visibleCase.paymentContext.activeRecoveryLink,
    diagnosedAt: decisionAt,
  });
  const scoringResult = await scoreRecoveryRecommendation(
    {
      caseId: visibleCase.caseId,
      seed: scorerSeed,
      recommendedAt: decisionAt,
      paymentContext: visibleCase.paymentContext,
      diagnosis,
      scoringConfig: configuration.scoringConfig,
    },
    new DeterministicMockAiProvider(),
  );
  const proposedAction = scoringResult.recommendation.selectedAction;
  const intent = actionIntent(proposedAction, visibleCase);
  const paymentLinks = activeLinkFixture(visibleCase);
  const recoveryWindowStartsAt = visibleCase.paymentContext.eventCreatedAt;
  const caseRecord = recoveryCaseRecordSchema.parse({
    caseId: visibleCase.caseId,
    paymentId: visibleCase.paymentContext.paymentId,
    orderId: visibleCase.paymentContext.orderId,
    syntheticCustomerHash: visibleCase.paymentContext.syntheticCustomerHash,
    verifiedUnpaidAmountSubunits:
      visibleCase.paymentContext.money.amountSubunits,
    currency: visibleCase.paymentContext.money.currency,
    state: "AWAITING_POLICY",
    attemptNumber: visibleCase.paymentContext.attemptNumber,
    previousSuccessCount: visibleCase.paymentContext.previousSuccessCount,
    previousFailureCount: visibleCase.paymentContext.previousFailureCount,
    contactCount: visibleCase.paymentContext.previousContactCount,
    recoveryWindowStartsAt,
    recoveryWindowEndsAt: new Date(
      Date.parse(recoveryWindowStartsAt) +
        configuration.policyConfig.maxRecoveryWindowMilliseconds,
    ).toISOString(),
    version: 1,
    createdAt: recoveryWindowStartsAt,
    updatedAt: decisionAt,
  });
  const policyResult = evaluateRecoveryPolicy({
    caseRecord,
    paymentContext: visibleCase.paymentContext,
    paymentSatisfaction: visibleCase.paymentSatisfaction,
    diagnosis,
    aiScoringResult: scoringResult,
    intent,
    totalPaymentLinksCreated: paymentLinks.length,
    paymentLinks,
    evaluatedAt: decisionAt,
    config: configuration.policyConfig,
  });
  const finalAction =
    policyResult.status === "DECIDED"
      ? (policyResult.decision.finalAction ?? "ESCALATE_HUMAN")
      : "ESCALATE_HUMAN";
  const revealed = oracle.revealSelectedOutcome({
    caseId: visibleCase.caseId,
    selectedAction: finalAction,
    selectedAt: decisionAt,
  });
  const policyRuleId =
    policyResult.status === "DECIDED"
      ? policyResult.decision.ruleId
      : "POLICY_INVALID_INPUT";
  const policyOutcome =
    policyResult.status === "DECIDED"
      ? policyResult.decision.outcome
      : "BLOCKED";
  const createsPaymentLink =
    finalAction === "SEND_PAYMENT_LINK" &&
    intent.action === "SEND_PAYMENT_LINK" &&
    intent.linkUse.mode === "CREATE_NEW" &&
    policyOutcome === "APPROVED";

  return {
    caseId: visibleCase.caseId,
    predictedFailureClass: diagnosis.failureClass,
    selectedAction: finalAction,
    proposedAction,
    scoringFallback: scoringResult.status === "SAFE_FALLBACK",
    policyInvalid: policyResult.status === "INVALID_INPUT",
    safetyRedirectedOrBlocked:
      policyOutcome === "BLOCKED" || finalAction !== proposedAction,
    duplicateChargeAttemptPrevented:
      policyRuleId === "ORIGINAL_PAYMENT_SATISFIED",
    createsPaymentLink,
    policyRuleId,
    revealed,
  };
}

function sumMoney(values: readonly number[], label: string): number {
  return values.reduce(
    (sum, value) => checkedAddNonnegativeSubunits(sum, value, label),
    0,
  );
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function aggregate(
  batch: DigitalTwinSelectionBatch,
  configuration: EvaluationConfiguration,
  baselineTraces: readonly BaselineTrace[],
  recoverAiTraces: readonly StrategyTrace[],
): SimulatedEvaluationResult {
  const uniqueCaseCount = batch.cases.length;
  const currency = batch.cases[0]?.paymentContext.money.currency;
  if (
    currency === undefined ||
    batch.cases.some(
      ({ paymentContext }) => paymentContext.money.currency !== currency,
    )
  ) {
    throw new Error(
      "Evaluation requires one validated currency across every case.",
    );
  }
  const initiallyAtRisk = sumMoney(
    batch.cases.map(
      ({ paymentContext }) => paymentContext.money.amountSubunits,
    ),
    "Initial simulated revenue at risk",
  );
  const baselineRecovery = sumMoney(
    baselineTraces.map(({ revealed }) =>
      revealed.outcome.recovered
        ? revealed.outcome.simulatedRecoveredAmountSubunits
        : 0,
    ),
    "Baseline simulated recovery",
  );
  const recoverAiRecovery = sumMoney(
    recoverAiTraces.map(({ revealed }) =>
      revealed.outcome.recovered
        ? revealed.outcome.simulatedRecoveredAmountSubunits
        : 0,
    ),
    "RecoverAI simulated recovery",
  );
  const baselineRecoveredCaseCount = baselineTraces.filter(
    ({ revealed }) => revealed.outcome.recovered,
  ).length;
  const recoverAiRecoveredCaseCount = recoverAiTraces.filter(
    ({ revealed }) => revealed.outcome.recovered,
  ).length;
  const rootCauseCorrectCount = recoverAiTraces.filter(
    (trace) =>
      trace.predictedFailureClass === trace.revealed.groundTruthFailureClass,
  ).length;
  const actionSelectionCorrectCount = recoverAiTraces.filter(
    ({ revealed }) => revealed.groundTruthActionAllowed,
  ).length;
  const baselineCustomerContactCount = sumMoney(
    baselineTraces.map(
      ({ revealed }) => revealed.outcome.simulatedCustomerContactCount,
    ),
    "Baseline customer contacts",
  );
  const recoverAiCustomerContactCount = sumMoney(
    recoverAiTraces.map(
      ({ revealed }) => revealed.outcome.simulatedCustomerContactCount,
    ),
    "RecoverAI customer contacts",
  );
  const humanEscalationCount = recoverAiTraces.filter(
    ({ selectedAction }) => selectedAction === "ESCALATE_HUMAN",
  ).length;
  const unresolvedTraces = recoverAiTraces.filter(({ revealed }) =>
    ["SIMULATED_UNRESOLVED", "SIMULATED_ESCALATED"].includes(
      revealed.outcome.simulatedResolution,
    ),
  );

  const byFailureClass = FAILURE_CLASSES.map((failureClass) => {
    const traces = recoverAiTraces.filter(
      ({ revealed }) => revealed.groundTruthFailureClass === failureClass,
    );
    const cases = batch.cases.filter(({ caseId }) =>
      traces.some((trace) => trace.caseId === caseId),
    );
    const recoveredCount = traces.filter(
      ({ revealed }) => revealed.outcome.recovered,
    ).length;
    const rootCauseCorrectCount = traces.filter(
      (trace) => trace.predictedFailureClass === failureClass,
    ).length;
    const actionSelectionCorrectCount = traces.filter(
      ({ revealed }) => revealed.groundTruthActionAllowed,
    ).length;
    return {
      failureClass,
      uniqueCaseCount: traces.length,
      recoveredCaseCount: recoveredCount,
      rootCauseCorrectCount,
      actionSelectionCorrectCount,
      simulatedRevenueAtRisk: {
        amountSubunits: sumMoney(
          cases.map(
            ({ paymentContext }) => paymentContext.money.amountSubunits,
          ),
          `${failureClass} simulated risk`,
        ),
        currency,
      },
      simulatedRevenueRecovered: {
        amountSubunits: sumMoney(
          traces.map(({ revealed }) =>
            revealed.outcome.recovered
              ? revealed.outcome.simulatedRecoveredAmountSubunits
              : 0,
          ),
          `${failureClass} simulated recovery`,
        ),
        currency,
      },
      simulatedRecoveryRate: rate(recoveredCount, traces.length),
      rootCauseAccuracy: rate(rootCauseCorrectCount, traces.length),
      actionSelectionAccuracy: rate(actionSelectionCorrectCount, traces.length),
      unresolvedExceptionCount: traces.filter(({ revealed }) =>
        ["SIMULATED_UNRESOLVED", "SIMULATED_ESCALATED"].includes(
          revealed.outcome.simulatedResolution,
        ),
      ).length,
    };
  });

  const bySelectedAction = RECOVERY_ACTIONS.map((selectedAction) => {
    const traces = recoverAiTraces.filter(
      (trace) => trace.selectedAction === selectedAction,
    );
    const recoveredCount = traces.filter(
      ({ revealed }) => revealed.outcome.recovered,
    ).length;
    return {
      selectedAction,
      caseCount: traces.length,
      recoveredCaseCount: recoveredCount,
      simulatedRevenueRecovered: {
        amountSubunits: sumMoney(
          traces.map(({ revealed }) =>
            revealed.outcome.recovered
              ? revealed.outcome.simulatedRecoveredAmountSubunits
              : 0,
          ),
          `${selectedAction} simulated recovery`,
        ),
        currency,
      },
      simulatedRecoveryRate: rate(recoveredCount, traces.length),
    };
  });

  const confusionMatrix = FAILURE_CLASSES.flatMap((actualFailureClass) =>
    FAILURE_CLASSES.map((predictedFailureClass) => ({
      actualFailureClass,
      predictedFailureClass,
      caseCount: recoverAiTraces.filter(
        (trace) =>
          trace.revealed.groundTruthFailureClass === actualFailureClass &&
          trace.predictedFailureClass === predictedFailureClass,
      ).length,
    })),
  );
  const falsePositiveCost = sumMoney(
    recoverAiTraces.map(
      ({ revealed }) => revealed.outcome.simulatedFalsePositiveCostSubunits,
    ),
    "Simulated false-positive intervention cost",
  );
  const logicalProcessingMilliseconds =
    uniqueCaseCount * (6 + 4 + 7 + 11 + 9 + 4) +
    batch.manifest.uniqueProviderEventCount * 3 +
    batch.manifest.duplicateDeliveryCount * 2;

  return simulatedEvaluationResultSchema.parse({
    simulationLabel: "SIMULATED",
    evaluationRunId: checkedRunIdentity(batch, configuration),
    datasetVersion: batch.datasetVersion,
    datasetFingerprintSha256: batch.manifest.fingerprintSha256,
    evaluationPolicyVersion: configuration.evaluationPolicyVersion,
    baselinePolicyVersion: configuration.baselinePolicyVersion,
    seed: batch.seed,
    completedAt: configuration.completedAt,
    uniqueCaseCount,
    uniqueProviderEventCount: batch.manifest.uniqueProviderEventCount,
    eventDeliveryCount: batch.deliveries.length,
    duplicateDeliveryCount: batch.manifest.duplicateDeliveryCount,
    simulatedRevenueInitiallyAtRisk: {
      amountSubunits: initiallyAtRisk,
      currency,
    },
    baselineSimulatedRecovery: { amountSubunits: baselineRecovery, currency },
    recoverAiSimulatedRecovery: { amountSubunits: recoverAiRecovery, currency },
    incrementalSimulatedRecovery: {
      subunitDelta: checkedSubtractSubunits(
        recoverAiRecovery,
        baselineRecovery,
        "Incremental simulated recovery",
      ),
      currency,
    },
    baselineRecoveredCaseCount,
    recoverAiRecoveredCaseCount,
    simulatedRecoveryRate: rate(recoverAiRecoveredCaseCount, uniqueCaseCount),
    rootCauseCorrectCount,
    rootCauseAccuracy: rate(rootCauseCorrectCount, uniqueCaseCount),
    actionSelectionCorrectCount,
    actionSelectionAccuracy: rate(actionSelectionCorrectCount, uniqueCaseCount),
    unsafeActionsBlocked: recoverAiTraces.filter(
      ({ safetyRedirectedOrBlocked }) => safetyRedirectedOrBlocked,
    ).length,
    duplicateEventsIgnored: batch.manifest.duplicateDeliveryCount,
    duplicateChargeAttemptsPrevented: recoverAiTraces.filter(
      ({ duplicateChargeAttemptPrevented }) => duplicateChargeAttemptPrevented,
    ).length,
    baselineCustomerContactCount,
    recoverAiCustomerContactCount,
    customerContactsAvoided: Math.max(
      0,
      baselineCustomerContactCount - recoverAiCustomerContactCount,
    ),
    humanEscalationCount,
    humanEscalationRate: rate(humanEscalationCount, uniqueCaseCount),
    falsePositiveInterventionCostSimulated: {
      amountSubunits: falsePositiveCost,
      currency,
    },
    baselinePaymentLinkCreationCount: baselineTraces.filter(
      ({ selection }) => selection.createsPaymentLink,
    ).length,
    paymentLinkCreationCount: recoverAiTraces.filter(
      ({ createsPaymentLink }) => createsPaymentLink,
    ).length,
    apiFallbackOrFailureCount: recoverAiTraces.filter(
      ({ scoringFallback, policyInvalid }) => scoringFallback || policyInvalid,
    ).length,
    meanProcessingTimeMilliseconds:
      logicalProcessingMilliseconds / batch.deliveries.length,
    processingTimeModel: PROCESSING_TIME_MODEL,
    unresolvedExceptionCount: unresolvedTraces.length,
    unresolvedExceptions: unresolvedTraces.map(({ caseId, revealed }) => ({
      caseReference: caseId,
      strategy: "RECOVERAI" as const,
      reasonCode: revealed.outcome.simulatedResolution.replace(
        "SIMULATED_",
        "",
      ),
    })),
    confusionMatrix,
    resultsByFailureClass: byFailureClass,
    resultsBySelectedAction: bySelectedAction,
  });
}

export async function runHeldOutEvaluation(input: {
  selectionBatch: DigitalTwinSelectionBatch;
  oracle: SelectedOutcomeOracle;
  configuration?: EvaluationConfiguration;
}): Promise<SimulatedEvaluationResult> {
  const batch = digitalTwinSelectionBatchSchema.parse(input.selectionBatch);
  const configuration = evaluationConfigurationSchema.parse(
    input.configuration ?? DEFAULT_EVALUATION_CONFIGURATION,
  );
  assertLockedHeldOutBatch(batch);

  const baselineTraces: BaselineTrace[] = [];
  const recoverAiTraces: StrategyTrace[] = [];
  for (const visibleCase of batch.cases) {
    const selection = selectCanonicalBaselineAction(baselineInput(visibleCase));
    const baselineRevealed = input.oracle.revealSelectedOutcome({
      caseId: visibleCase.caseId,
      selectedAction: selection.selectedAction,
      selectedAt: selection.decisionAt,
    });
    baselineTraces.push({ selection, revealed: baselineRevealed });

    const recoverAiTrace = await evaluateRecoverAiCase(
      visibleCase,
      input.oracle,
      configuration,
      batch.seed,
    );
    if (
      recoverAiTrace.revealed.groundTruthFailureClass !==
      baselineRevealed.groundTruthFailureClass
    ) {
      throw new Error("Strategies did not use the same held-out case oracle.");
    }
    recoverAiTraces.push(recoverAiTrace);
  }
  return aggregate(batch, configuration, baselineTraces, recoverAiTraces);
}
