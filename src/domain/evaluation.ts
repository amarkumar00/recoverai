import { z } from "zod";

import { RECOVERY_ACTIONS, recoveryActionSchema } from "@/domain/actions";
import { FAILURE_CLASSES, failureClassSchema } from "@/domain/diagnosis";
import {
  canonicalTimestampSchema,
  caseIdSchema,
  evaluationRunIdSchema,
  moneyDeltaSchema,
  moneySchema,
  nonnegativeCountSchema,
  positiveCountSchema,
  unitIntervalSchema,
} from "@/domain/primitives";

const versionIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const FAILURE_CLASS_COUNT = FAILURE_CLASSES.length;
const RECOVERY_ACTION_COUNT = RECOVERY_ACTIONS.length;

export const unresolvedEvaluationExceptionSchema = z
  .object({
    caseReference: caseIdSchema,
    strategy: z.literal("RECOVERAI"),
    reasonCode: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Z][A-Z0-9_]*$/),
  })
  .strict();

export const confusionMatrixCellSchema = z
  .object({
    actualFailureClass: failureClassSchema,
    predictedFailureClass: failureClassSchema,
    caseCount: nonnegativeCountSchema,
  })
  .strict();

export const evaluationByFailureClassSchema = z
  .object({
    failureClass: failureClassSchema,
    uniqueCaseCount: nonnegativeCountSchema,
    recoveredCaseCount: nonnegativeCountSchema,
    rootCauseCorrectCount: nonnegativeCountSchema,
    actionSelectionCorrectCount: nonnegativeCountSchema,
    simulatedRevenueAtRisk: moneySchema,
    simulatedRevenueRecovered: moneySchema,
    simulatedRecoveryRate: unitIntervalSchema,
    rootCauseAccuracy: unitIntervalSchema,
    actionSelectionAccuracy: unitIntervalSchema,
    unresolvedExceptionCount: nonnegativeCountSchema,
  })
  .strict();

export const evaluationBySelectedActionSchema = z
  .object({
    selectedAction: recoveryActionSchema,
    caseCount: nonnegativeCountSchema,
    recoveredCaseCount: nonnegativeCountSchema,
    simulatedRevenueRecovered: moneySchema,
    simulatedRecoveryRate: unitIntervalSchema,
  })
  .strict();

export const simulatedEvaluationResultSchema = z
  .object({
    simulationLabel: z.literal("SIMULATED"),
    evaluationRunId: evaluationRunIdSchema,
    datasetVersion: versionIdentifierSchema,
    datasetFingerprintSha256: z.string().regex(/^[a-f0-9]{64}$/),
    evaluationPolicyVersion: versionIdentifierSchema,
    baselinePolicyVersion: versionIdentifierSchema,
    seed: z.string().trim().min(1).max(128),
    completedAt: canonicalTimestampSchema,
    uniqueCaseCount: positiveCountSchema,
    uniqueProviderEventCount: positiveCountSchema,
    eventDeliveryCount: positiveCountSchema,
    duplicateDeliveryCount: nonnegativeCountSchema,
    simulatedRevenueInitiallyAtRisk: moneySchema,
    baselineSimulatedRecovery: moneySchema,
    recoverAiSimulatedRecovery: moneySchema,
    incrementalSimulatedRecovery: moneyDeltaSchema,
    baselineRecoveredCaseCount: nonnegativeCountSchema,
    recoverAiRecoveredCaseCount: nonnegativeCountSchema,
    simulatedRecoveryRate: unitIntervalSchema,
    rootCauseCorrectCount: nonnegativeCountSchema,
    rootCauseAccuracy: unitIntervalSchema,
    actionSelectionCorrectCount: nonnegativeCountSchema,
    actionSelectionAccuracy: unitIntervalSchema,
    unsafeActionsBlocked: nonnegativeCountSchema,
    duplicateEventsIgnored: nonnegativeCountSchema,
    duplicateChargeAttemptsPrevented: nonnegativeCountSchema,
    baselineCustomerContactCount: nonnegativeCountSchema,
    recoverAiCustomerContactCount: nonnegativeCountSchema,
    customerContactsAvoided: nonnegativeCountSchema,
    humanEscalationCount: nonnegativeCountSchema,
    humanEscalationRate: unitIntervalSchema,
    falsePositiveInterventionCostSimulated: moneySchema,
    baselinePaymentLinkCreationCount: nonnegativeCountSchema,
    paymentLinkCreationCount: nonnegativeCountSchema,
    apiFallbackOrFailureCount: nonnegativeCountSchema,
    meanProcessingTimeMilliseconds: z.number().finite().nonnegative(),
    processingTimeModel: z.literal("SIMULATED_DETERMINISTIC_LOGICAL_V1"),
    unresolvedExceptionCount: nonnegativeCountSchema,
    unresolvedExceptions: z.array(unresolvedEvaluationExceptionSchema).max(100),
    confusionMatrix: z.array(confusionMatrixCellSchema).min(1),
    resultsByFailureClass: z.array(evaluationByFailureClassSchema).min(1),
    resultsBySelectedAction: z.array(evaluationBySelectedActionSchema).min(1),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.eventDeliveryCount < result.uniqueCaseCount) {
      context.addIssue({
        code: "custom",
        path: ["eventDeliveryCount"],
        message: "Event deliveries cannot be fewer than unique cases.",
      });
    }

    if (
      result.eventDeliveryCount !==
      result.uniqueProviderEventCount + result.duplicateDeliveryCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["duplicateDeliveryCount"],
        message:
          "Event deliveries must equal unique provider events plus duplicate deliveries.",
      });
    }
    if (result.duplicateEventsIgnored !== result.duplicateDeliveryCount) {
      context.addIssue({
        code: "custom",
        path: ["duplicateEventsIgnored"],
        message:
          "Every duplicate delivery must be counted as ignored exactly once.",
      });
    }
    const boundedOverallCounts = [
      ["baselineRecoveredCaseCount", result.baselineRecoveredCaseCount],
      ["recoverAiRecoveredCaseCount", result.recoverAiRecoveredCaseCount],
      ["rootCauseCorrectCount", result.rootCauseCorrectCount],
      ["actionSelectionCorrectCount", result.actionSelectionCorrectCount],
      ["humanEscalationCount", result.humanEscalationCount],
      ["unresolvedExceptionCount", result.unresolvedExceptionCount],
      ["unsafeActionsBlocked", result.unsafeActionsBlocked],
      [
        "duplicateChargeAttemptsPrevented",
        result.duplicateChargeAttemptsPrevented,
      ],
      ["baselineCustomerContactCount", result.baselineCustomerContactCount],
      ["recoverAiCustomerContactCount", result.recoverAiCustomerContactCount],
      [
        "baselinePaymentLinkCreationCount",
        result.baselinePaymentLinkCreationCount,
      ],
      ["paymentLinkCreationCount", result.paymentLinkCreationCount],
      ["apiFallbackOrFailureCount", result.apiFallbackOrFailureCount],
    ] as const;
    for (const [field, count] of boundedOverallCounts) {
      if (count > result.uniqueCaseCount) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "Case-level evaluation counts cannot exceed unique cases.",
        });
      }
    }

    const currencies = [
      result.simulatedRevenueInitiallyAtRisk.currency,
      result.baselineSimulatedRecovery.currency,
      result.recoverAiSimulatedRecovery.currency,
      result.incrementalSimulatedRecovery.currency,
      result.falsePositiveInterventionCostSimulated.currency,
      ...result.resultsByFailureClass.flatMap((group) => [
        group.simulatedRevenueAtRisk.currency,
        group.simulatedRevenueRecovered.currency,
      ]),
      ...result.resultsBySelectedAction.map(
        (group) => group.simulatedRevenueRecovered.currency,
      ),
    ];

    if (new Set(currencies).size !== 1) {
      context.addIssue({
        code: "custom",
        path: ["incrementalSimulatedRecovery", "currency"],
        message: "All evaluation money values must use one currency.",
      });
    }
    if (
      result.baselineSimulatedRecovery.amountSubunits >
        result.simulatedRevenueInitiallyAtRisk.amountSubunits ||
      result.recoverAiSimulatedRecovery.amountSubunits >
        result.simulatedRevenueInitiallyAtRisk.amountSubunits
    ) {
      context.addIssue({
        code: "custom",
        path: ["simulatedRevenueInitiallyAtRisk"],
        message:
          "A strategy cannot recover more simulated revenue than was initially at risk.",
      });
    }

    const expectedIncremental =
      BigInt(result.recoverAiSimulatedRecovery.amountSubunits) -
      BigInt(result.baselineSimulatedRecovery.amountSubunits);
    if (
      expectedIncremental !==
      BigInt(result.incrementalSimulatedRecovery.subunitDelta)
    ) {
      context.addIssue({
        code: "custom",
        path: ["incrementalSimulatedRecovery", "subunitDelta"],
        message:
          "Incremental simulated recovery must equal RecoverAI minus baseline.",
      });
    }

    const expectedRate =
      result.recoverAiRecoveredCaseCount / result.uniqueCaseCount;
    if (result.simulatedRecoveryRate !== expectedRate) {
      context.addIssue({
        code: "custom",
        path: ["simulatedRecoveryRate"],
        message:
          "Simulated recovery rate must use unique cases as denominator.",
      });
    }
    if (
      result.rootCauseAccuracy !==
      result.rootCauseCorrectCount / result.uniqueCaseCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["rootCauseAccuracy"],
        message: "Root-cause accuracy must use unique cases as denominator.",
      });
    }
    if (
      result.actionSelectionAccuracy !==
      result.actionSelectionCorrectCount / result.uniqueCaseCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["actionSelectionAccuracy"],
        message:
          "Action-selection accuracy must use unique cases as denominator.",
      });
    }
    if (
      result.humanEscalationRate !==
      result.humanEscalationCount / result.uniqueCaseCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["humanEscalationRate"],
        message: "Human-escalation rate must use unique cases as denominator.",
      });
    }
    for (const [index, group] of result.resultsByFailureClass.entries()) {
      if (
        group.recoveredCaseCount > group.uniqueCaseCount ||
        group.rootCauseCorrectCount > group.uniqueCaseCount ||
        group.actionSelectionCorrectCount > group.uniqueCaseCount ||
        group.simulatedRecoveryRate !==
          (group.uniqueCaseCount === 0
            ? 0
            : group.recoveredCaseCount / group.uniqueCaseCount)
      ) {
        context.addIssue({
          code: "custom",
          path: ["resultsByFailureClass", index, "simulatedRecoveryRate"],
          message:
            "Failure-class recovery rate must use that group's unique cases.",
        });
      }
      if (
        group.rootCauseAccuracy !==
          (group.uniqueCaseCount === 0
            ? 0
            : group.rootCauseCorrectCount / group.uniqueCaseCount) ||
        group.actionSelectionAccuracy !==
          (group.uniqueCaseCount === 0
            ? 0
            : group.actionSelectionCorrectCount / group.uniqueCaseCount)
      ) {
        context.addIssue({
          code: "custom",
          path: ["resultsByFailureClass", index],
          message:
            "Failure-class accuracy rates must use that group's unique cases.",
        });
      }
    }
    for (const [index, group] of result.resultsBySelectedAction.entries()) {
      if (
        group.recoveredCaseCount > group.caseCount ||
        group.simulatedRecoveryRate !==
          (group.caseCount === 0
            ? 0
            : group.recoveredCaseCount / group.caseCount)
      ) {
        context.addIssue({
          code: "custom",
          path: ["resultsBySelectedAction", index, "simulatedRecoveryRate"],
          message:
            "Selected-action recovery rate must use that group's unique cases.",
        });
      }
    }
    if (
      result.customerContactsAvoided !==
      Math.max(
        0,
        result.baselineCustomerContactCount -
          result.recoverAiCustomerContactCount,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["customerContactsAvoided"],
        message:
          "Contacts avoided must be the nonnegative baseline-relative contact difference.",
      });
    }
    if (
      result.unresolvedExceptions.length !== result.unresolvedExceptionCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["unresolvedExceptions"],
        message: "The unresolved exception list must match its reported count.",
      });
    }
    if (
      new Set(
        result.unresolvedExceptions.map(({ caseReference }) => caseReference),
      ).size !== result.unresolvedExceptions.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["unresolvedExceptions"],
        message: "Unresolved exception case references must be unique.",
      });
    }

    const failureClasses = result.resultsByFailureClass.map(
      (group) => group.failureClass,
    );
    if (new Set(failureClasses).size !== failureClasses.length) {
      context.addIssue({
        code: "custom",
        path: ["resultsByFailureClass"],
        message: "Failure-class result groups must be unique.",
      });
    }
    if (
      failureClasses.length !== FAILURE_CLASS_COUNT ||
      FAILURE_CLASSES.some(
        (failureClass) => !failureClasses.includes(failureClass),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["resultsByFailureClass"],
        message:
          "Results must contain every canonical failure class exactly once.",
      });
    }

    const selectedActions = result.resultsBySelectedAction.map(
      (group) => group.selectedAction,
    );
    if (new Set(selectedActions).size !== selectedActions.length) {
      context.addIssue({
        code: "custom",
        path: ["resultsBySelectedAction"],
        message: "Selected-action result groups must be unique.",
      });
    }
    if (
      selectedActions.length !== RECOVERY_ACTION_COUNT ||
      RECOVERY_ACTIONS.some((action) => !selectedActions.includes(action))
    ) {
      context.addIssue({
        code: "custom",
        path: ["resultsBySelectedAction"],
        message:
          "Results must contain every canonical recovery action exactly once.",
      });
    }

    const failureCaseTotal = result.resultsByFailureClass.reduce(
      (sum, group) => sum + group.uniqueCaseCount,
      0,
    );
    const failureRiskTotal = result.resultsByFailureClass.reduce(
      (sum, group) => sum + BigInt(group.simulatedRevenueAtRisk.amountSubunits),
      BigInt(0),
    );
    const failureRecoveryTotal = result.resultsByFailureClass.reduce(
      (sum, group) =>
        sum + BigInt(group.simulatedRevenueRecovered.amountSubunits),
      BigInt(0),
    );
    const failureUnresolvedTotal = result.resultsByFailureClass.reduce(
      (sum, group) => sum + group.unresolvedExceptionCount,
      0,
    );
    const failureRecoveredCaseTotal = result.resultsByFailureClass.reduce(
      (sum, group) => sum + group.recoveredCaseCount,
      0,
    );
    const failureRootCauseCorrectTotal = result.resultsByFailureClass.reduce(
      (sum, group) => sum + group.rootCauseCorrectCount,
      0,
    );
    const failureActionCorrectTotal = result.resultsByFailureClass.reduce(
      (sum, group) => sum + group.actionSelectionCorrectCount,
      0,
    );
    if (failureCaseTotal !== result.uniqueCaseCount) {
      context.addIssue({
        code: "custom",
        path: ["resultsByFailureClass"],
        message: "Failure-class case totals must equal the overall case count.",
      });
    }
    if (
      failureRiskTotal !==
        BigInt(result.simulatedRevenueInitiallyAtRisk.amountSubunits) ||
      failureRecoveryTotal !==
        BigInt(result.recoverAiSimulatedRecovery.amountSubunits) ||
      failureRecoveredCaseTotal !== result.recoverAiRecoveredCaseCount ||
      failureRootCauseCorrectTotal !== result.rootCauseCorrectCount ||
      failureActionCorrectTotal !== result.actionSelectionCorrectCount ||
      failureUnresolvedTotal !== result.unresolvedExceptionCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["resultsByFailureClass"],
        message:
          "Failure-class money and unresolved totals must equal overall totals.",
      });
    }

    const selectedCaseTotal = result.resultsBySelectedAction.reduce(
      (sum, group) => sum + group.caseCount,
      0,
    );
    const selectedRecoveryTotal = result.resultsBySelectedAction.reduce(
      (sum, group) =>
        sum + BigInt(group.simulatedRevenueRecovered.amountSubunits),
      BigInt(0),
    );
    const selectedRecoveredCaseTotal = result.resultsBySelectedAction.reduce(
      (sum, group) => sum + group.recoveredCaseCount,
      0,
    );
    if (
      selectedCaseTotal !== result.uniqueCaseCount ||
      selectedRecoveredCaseTotal !== result.recoverAiRecoveredCaseCount ||
      selectedRecoveryTotal !==
        BigInt(result.recoverAiSimulatedRecovery.amountSubunits)
    ) {
      context.addIssue({
        code: "custom",
        path: ["resultsBySelectedAction"],
        message: "Selected-action group totals must equal overall totals.",
      });
    }

    const matrixKeys = result.confusionMatrix.map(
      (cell) => `${cell.actualFailureClass}|${cell.predictedFailureClass}`,
    );
    const expectedMatrixCellCount = FAILURE_CLASS_COUNT * FAILURE_CLASS_COUNT;
    if (
      result.confusionMatrix.length !== expectedMatrixCellCount ||
      new Set(matrixKeys).size !== expectedMatrixCellCount ||
      result.confusionMatrix.reduce((sum, cell) => sum + cell.caseCount, 0) !==
        result.uniqueCaseCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["confusionMatrix"],
        message:
          "The confusion matrix must contain every class pair exactly once and total all unique cases.",
      });
    }
  });

export type ConfusionMatrixCell = z.infer<typeof confusionMatrixCellSchema>;
export type EvaluationByFailureClass = z.infer<
  typeof evaluationByFailureClassSchema
>;
export type EvaluationBySelectedAction = z.infer<
  typeof evaluationBySelectedActionSchema
>;
export type SimulatedEvaluationResult = z.infer<
  typeof simulatedEvaluationResultSchema
>;
