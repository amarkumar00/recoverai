import { z } from "zod";

import { RECOVERY_ACTIONS, recoveryActionSchema } from "@/domain/actions";
import { failureClassSchema } from "@/domain/diagnosis";
import {
  amountSubunitsSchema,
  boundedReasonSchema,
  canonicalTimestampSchema,
  caseIdSchema,
  nonnegativeCountSchema,
} from "@/domain/primitives";

import type { DigitalTwinSelectionBatch } from "./contracts";
import {
  generateHeldOutMaterialForEvaluator,
  type HiddenGroundTruthRecord,
} from "./internal-generator";

export const simulatedResolutionSchema = z.enum([
  "SIMULATED_RECOVERED",
  "SIMULATED_UNRESOLVED",
  "SIMULATED_ESCALATED",
  "SIMULATED_STOPPED_LATE_SUCCESS",
  "SIMULATED_STOPPED_NON_RETRYABLE",
]);

export const hiddenSimulatedOutcomeSchema = z
  .object({
    simulationLabel: z.literal("SIMULATED"),
    recovered: z.boolean(),
    simulatedRecoveredAmountSubunits: amountSubunitsSchema,
    simulatedRecoveryDelaySeconds: nonnegativeCountSchema,
    simulatedCustomerContactCount: nonnegativeCountSchema,
    simulatedFalsePositiveCostSubunits: amountSubunitsSchema,
    simulatedResolution: simulatedResolutionSchema,
    simulatedReason: boundedReasonSchema,
  })
  .strict()
  .superRefine((outcome, context) => {
    if (outcome.recovered !== outcome.simulatedRecoveredAmountSubunits > 0) {
      context.addIssue({
        code: "custom",
        path: ["simulatedRecoveredAmountSubunits"],
        message:
          "A simulated recovered amount must be positive exactly when recovery succeeds.",
      });
    }
  });

const hiddenOutcomeShape = Object.fromEntries(
  RECOVERY_ACTIONS.map((action) => [action, hiddenSimulatedOutcomeSchema]),
) as Record<
  (typeof RECOVERY_ACTIONS)[number],
  typeof hiddenSimulatedOutcomeSchema
>;

export const hiddenOutcomeByActionSchema = z
  .object(hiddenOutcomeShape)
  .strict();

export const hiddenGroundTruthRecordSchema = z
  .object({
    boundary: z.literal("EVALUATOR_ONLY_HIDDEN_SIMULATED"),
    caseId: caseIdSchema,
    groundTruthFailureClass: failureClassSchema,
    groundTruthAllowedActions: z.array(recoveryActionSchema).min(1).max(6),
    hiddenSimulatedOutcomeByAction: hiddenOutcomeByActionSchema,
  })
  .strict()
  .superRefine(({ groundTruthAllowedActions }, context) => {
    if (
      new Set(groundTruthAllowedActions).size !==
      groundTruthAllowedActions.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["groundTruthAllowedActions"],
        message: "Ground-truth actions must be unique.",
      });
    }
  });

export const revealSelectedOutcomeRequestSchema = z
  .object({
    caseId: caseIdSchema,
    selectedAction: recoveryActionSchema,
    selectedAt: canonicalTimestampSchema,
  })
  .strict();

export const revealedSelectedOutcomeSchema = z
  .object({
    boundary: z.literal("EVALUATOR_ONLY_AFTER_SELECTION"),
    caseId: caseIdSchema,
    selectedAction: recoveryActionSchema,
    selectedAt: canonicalTimestampSchema,
    groundTruthFailureClass: failureClassSchema,
    groundTruthActionAllowed: z.boolean(),
    outcome: hiddenSimulatedOutcomeSchema,
  })
  .strict();

export type HiddenSimulatedOutcome = z.infer<
  typeof hiddenSimulatedOutcomeSchema
>;
export type RevealedSelectedOutcome = z.infer<
  typeof revealedSelectedOutcomeSchema
>;

export class HeldOutOutcomeEvaluator {
  readonly #records: ReadonlyMap<string, HiddenGroundTruthRecord>;

  constructor(records: readonly HiddenGroundTruthRecord[]) {
    const validated = records.map((record) =>
      hiddenGroundTruthRecordSchema.parse(record),
    );
    if (
      new Set(validated.map(({ caseId }) => caseId)).size !== validated.length
    ) {
      throw new Error("Evaluator-only case IDs must be unique.");
    }
    this.#records = new Map(validated.map((record) => [record.caseId, record]));
  }

  get caseCount(): number {
    return this.#records.size;
  }

  revealSelectedOutcome(
    rawRequest: z.input<typeof revealSelectedOutcomeRequestSchema>,
  ): RevealedSelectedOutcome {
    const request = revealSelectedOutcomeRequestSchema.parse(rawRequest);
    const record = this.#records.get(request.caseId);
    if (record === undefined) {
      throw new Error(
        "Selected Digital Twin case is unavailable to evaluator.",
      );
    }

    return revealedSelectedOutcomeSchema.parse({
      boundary: "EVALUATOR_ONLY_AFTER_SELECTION",
      ...request,
      groundTruthFailureClass: record.groundTruthFailureClass,
      groundTruthActionAllowed: record.groundTruthAllowedActions.includes(
        request.selectedAction,
      ),
      outcome: record.hiddenSimulatedOutcomeByAction[request.selectedAction],
    });
  }
}

export type HeldOutDigitalTwin = {
  selectionBatch: DigitalTwinSelectionBatch;
  evaluator: HeldOutOutcomeEvaluator;
};

export function createHeldOutDigitalTwin(seed?: string): HeldOutDigitalTwin {
  const material = generateHeldOutMaterialForEvaluator(seed);
  return {
    selectionBatch: material.selectionBatch,
    evaluator: new HeldOutOutcomeEvaluator(material.hiddenGroundTruthRecords),
  };
}
