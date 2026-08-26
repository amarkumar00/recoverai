import { describe, expect, it } from "vitest";

import { simulatedEvaluationResultSchema } from "@/domain/evaluation";
import { validSimulatedEvaluation } from "@/domain/__tests__/fixtures";

describe("strict simulated evaluation metric consistency", () => {
  it("enforces the canonical signed incremental simulated-recovery formula", () => {
    expect(
      simulatedEvaluationResultSchema.safeParse({
        ...validSimulatedEvaluation,
        incrementalSimulatedRecovery: {
          subunitDelta: 1,
          currency: "INR",
        },
      }).success,
    ).toBe(false);
  });

  it.each([
    ["simulatedRecoveryRate", 0.5],
    ["rootCauseAccuracy", 0.5],
    ["actionSelectionAccuracy", 0.5],
    ["humanEscalationRate", 0.5],
  ])("rejects an inconsistent %s numerator/denominator", (field, value) => {
    expect(
      simulatedEvaluationResultSchema.safeParse({
        ...validSimulatedEvaluation,
        [field]: value,
      }).success,
    ).toBe(false);
  });

  it("requires complete class/action groups and a complete 7x7 confusion matrix", () => {
    expect(
      simulatedEvaluationResultSchema.safeParse({
        ...validSimulatedEvaluation,
        resultsByFailureClass:
          validSimulatedEvaluation.resultsByFailureClass.slice(1),
      }).success,
    ).toBe(false);
    expect(
      simulatedEvaluationResultSchema.safeParse({
        ...validSimulatedEvaluation,
        resultsBySelectedAction:
          validSimulatedEvaluation.resultsBySelectedAction.slice(1),
      }).success,
    ).toBe(false);
    expect(
      simulatedEvaluationResultSchema.safeParse({
        ...validSimulatedEvaluation,
        confusionMatrix: validSimulatedEvaluation.confusionMatrix.slice(1),
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate-sensitive, contact, unresolved, group, and currency inconsistencies", () => {
    const invalidResults = [
      {
        ...validSimulatedEvaluation,
        duplicateEventsIgnored: 12,
      },
      {
        ...validSimulatedEvaluation,
        customerContactsAvoided: 20,
      },
      {
        ...validSimulatedEvaluation,
        unresolvedExceptions:
          validSimulatedEvaluation.unresolvedExceptions.slice(1),
      },
      {
        ...validSimulatedEvaluation,
        resultsBySelectedAction:
          validSimulatedEvaluation.resultsBySelectedAction.map(
            (group, index) =>
              index === 0
                ? {
                    ...group,
                    simulatedRevenueRecovered: {
                      amountSubunits:
                        group.simulatedRevenueRecovered.amountSubunits - 1,
                      currency: "INR",
                    },
                  }
                : group,
          ),
      },
      {
        ...validSimulatedEvaluation,
        falsePositiveInterventionCostSimulated: {
          amountSubunits: 50_000,
          currency: "USD",
        },
      },
    ];

    for (const invalid of invalidResults) {
      expect(simulatedEvaluationResultSchema.safeParse(invalid).success).toBe(
        false,
      );
    }
  });
});
