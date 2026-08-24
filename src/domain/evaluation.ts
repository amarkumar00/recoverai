import { z } from "zod";

import { recoveryActionSchema } from "@/domain/actions";
import { failureClassSchema } from "@/domain/diagnosis";
import {
  canonicalTimestampSchema,
  evaluationRunIdSchema,
  moneyDeltaSchema,
  moneySchema,
  nonnegativeCountSchema,
  positiveCountSchema,
  unitIntervalSchema,
} from "@/domain/primitives";

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
    simulatedRevenueRecovered: moneySchema,
    simulatedRecoveryRate: unitIntervalSchema,
  })
  .strict();

export const simulatedEvaluationResultSchema = z
  .object({
    evaluationRunId: evaluationRunIdSchema,
    seed: z.string().trim().min(1).max(128),
    completedAt: canonicalTimestampSchema,
    uniqueCaseCount: positiveCountSchema,
    eventDeliveryCount: positiveCountSchema,
    simulatedRevenueInitiallyAtRisk: moneySchema,
    baselineSimulatedRecovery: moneySchema,
    recoverAiSimulatedRecovery: moneySchema,
    incrementalSimulatedRecovery: moneyDeltaSchema,
    simulatedRecoveryRate: unitIntervalSchema,
    rootCauseAccuracy: unitIntervalSchema,
    actionSelectionAccuracy: unitIntervalSchema,
    unsafeActionsBlocked: nonnegativeCountSchema,
    duplicateEventsIgnored: nonnegativeCountSchema,
    duplicateChargeAttemptsPrevented: nonnegativeCountSchema,
    customerContactsAvoided: nonnegativeCountSchema,
    humanEscalationRate: unitIntervalSchema,
    falsePositiveInterventionCostSimulated: moneySchema,
    paymentLinkCreationCount: nonnegativeCountSchema,
    apiFallbackOrFailureCount: nonnegativeCountSchema,
    meanProcessingTimeMilliseconds: z.number().finite().nonnegative(),
    unresolvedExceptionCount: nonnegativeCountSchema,
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
