import { describe, expect, it } from "vitest";

import {
  LOCKED_DEFAULT_HELD_OUT_FINGERPRINT_SHA256,
  type ScorerVisibleDigitalTwinCase,
} from "@/digital-twin/contracts";
import {
  createHeldOutDigitalTwin,
  type RevealedSelectedOutcome,
} from "@/digital-twin/evaluator-only";
import type { RecoveryAction } from "@/domain/actions";
import {
  DEFAULT_EVALUATION_CONFIGURATION,
  runHeldOutEvaluation,
  type SelectedOutcomeOracle,
} from "@/evaluation/runner";

type RevealInput = {
  caseId: ScorerVisibleDigitalTwinCase["caseId"];
  selectedAction: RecoveryAction;
  selectedAt: string;
};

function recordingOracle(
  base: SelectedOutcomeOracle,
  calls: RevealInput[],
  mutate?: (outcome: RevealedSelectedOutcome) => RevealedSelectedOutcome,
): SelectedOutcomeOracle {
  return {
    revealSelectedOutcome(input) {
      calls.push(input);
      const revealed = base.revealSelectedOutcome(input);
      return mutate?.(revealed) ?? revealed;
    },
  };
}

describe("locked held-out evaluation runner", () => {
  it("evaluates 100 unique cases and 125 deliveries deterministically", async () => {
    const firstTwin = createHeldOutDigitalTwin();
    const secondTwin = createHeldOutDigitalTwin();
    const first = await runHeldOutEvaluation({
      selectionBatch: firstTwin.selectionBatch,
      oracle: firstTwin.evaluator,
    });
    const second = await runHeldOutEvaluation({
      selectionBatch: secondTwin.selectionBatch,
      oracle: secondTwin.evaluator,
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      simulationLabel: "SIMULATED",
      datasetFingerprintSha256: LOCKED_DEFAULT_HELD_OUT_FINGERPRINT_SHA256,
      uniqueCaseCount: 100,
      uniqueProviderEventCount: 112,
      eventDeliveryCount: 125,
      duplicateDeliveryCount: 13,
      duplicateEventsIgnored: 13,
    });
    expect(first.incrementalSimulatedRecovery.subunitDelta).toBe(
      first.recoverAiSimulatedRecovery.amountSubunits -
        first.baselineSimulatedRecovery.amountSubunits,
    );
    expect(first.confusionMatrix).toHaveLength(49);
    expect(
      firstTwin.selectionBatch.manifest.outOfOrderCaseCount,
    ).toBeGreaterThan(0);
    expect(first.duplicateEventsIgnored).toBe(
      firstTwin.selectionBatch.manifest.duplicateDeliveryCount,
    );
    expect(
      first.confusionMatrix.reduce((sum, cell) => sum + cell.caseCount, 0),
    ).toBe(100);
    expect(
      first.resultsByFailureClass.reduce(
        (sum, group) => sum + group.uniqueCaseCount,
        0,
      ),
    ).toBe(100);
    expect(
      first.resultsBySelectedAction.reduce(
        (sum, group) => sum + group.caseCount,
        0,
      ),
    ).toBe(100);
    expect(
      first.resultsByFailureClass.reduce(
        (sum, group) => sum + group.simulatedRevenueRecovered.amountSubunits,
        0,
      ),
    ).toBe(first.recoverAiSimulatedRecovery.amountSubunits);
    expect(
      first.resultsBySelectedAction.reduce(
        (sum, group) => sum + group.simulatedRevenueRecovered.amountSubunits,
        0,
      ),
    ).toBe(first.recoverAiSimulatedRecovery.amountSubunits);
    expect(first.rootCauseAccuracy).toBe(
      first.rootCauseCorrectCount / first.uniqueCaseCount,
    );
    expect(first.actionSelectionAccuracy).toBe(
      first.actionSelectionCorrectCount / first.uniqueCaseCount,
    );
    expect(first.simulatedRecoveryRate).toBe(
      first.recoverAiRecoveredCaseCount / first.uniqueCaseCount,
    );
    expect(first.humanEscalationRate).toBe(
      first.humanEscalationCount / first.uniqueCaseCount,
    );
    expect(first.customerContactsAvoided).toBe(
      Math.max(
        0,
        first.baselineCustomerContactCount -
          first.recoverAiCustomerContactCount,
      ),
    );
  });

  it("reveals exactly two selected outcomes per case only after each strategy fixes an action", async () => {
    const twin = createHeldOutDigitalTwin();
    const calls: RevealInput[] = [];
    await runHeldOutEvaluation({
      selectionBatch: twin.selectionBatch,
      oracle: recordingOracle(twin.evaluator, calls),
    });

    expect(calls).toHaveLength(200);
    for (const visibleCase of twin.selectionBatch.cases) {
      const caseCalls = calls.filter(
        ({ caseId }) => caseId === visibleCase.caseId,
      );
      expect(caseCalls).toHaveLength(2);
      expect(
        caseCalls.every(({ selectedAction }) => selectedAction.length > 0),
      ).toBe(true);
      if (
        visibleCase.scenario === "CAPTURED_BEFORE_AUTHORIZED_DELIVERY" ||
        visibleCase.scenario === "STALE_FAILED_AFTER_SUCCESS"
      ) {
        expect(caseCalls[1]?.selectedAction).toMatch(
          /^(?:CANCEL_RECOVERY_ALREADY_PAID|STOP_NON_RETRYABLE)$/,
        );
      }
    }
  });

  it("does not let changed hidden outcomes alter either strategy selection", async () => {
    const firstTwin = createHeldOutDigitalTwin();
    const secondTwin = createHeldOutDigitalTwin();
    const firstCalls: RevealInput[] = [];
    const secondCalls: RevealInput[] = [];
    const first = await runHeldOutEvaluation({
      selectionBatch: firstTwin.selectionBatch,
      oracle: recordingOracle(firstTwin.evaluator, firstCalls),
    });
    const changed = await runHeldOutEvaluation({
      selectionBatch: secondTwin.selectionBatch,
      oracle: recordingOracle(
        secondTwin.evaluator,
        secondCalls,
        (revealed) => ({
          ...revealed,
          outcome: {
            ...revealed.outcome,
            recovered: false,
            simulatedRecoveredAmountSubunits: 0,
            simulatedFalsePositiveCostSubunits:
              revealed.outcome.simulatedFalsePositiveCostSubunits + 1,
            simulatedResolution:
              revealed.selectedAction === "ESCALATE_HUMAN"
                ? "SIMULATED_ESCALATED"
                : "SIMULATED_UNRESOLVED",
          },
        }),
      ),
    });

    expect(secondCalls).toEqual(firstCalls);
    expect(changed.recoverAiSimulatedRecovery.amountSubunits).not.toBe(
      first.recoverAiSimulatedRecovery.amountSubunits,
    );
    expect(changed.unresolvedExceptionCount).toBe(100);
    expect(changed.falsePositiveInterventionCostSimulated.amountSubunits).toBe(
      first.falsePositiveInterventionCostSimulated.amountSubunits + 100,
    );
  });

  it("fails closed when fingerprint or evaluation version changes without a distinct supported contract", async () => {
    const twin = createHeldOutDigitalTwin();
    const mismatched = structuredClone(twin.selectionBatch);
    mismatched.manifest.fingerprintSha256 = "0".repeat(64);
    await expect(
      runHeldOutEvaluation({
        selectionBatch: mismatched,
        oracle: twin.evaluator,
      }),
    ).rejects.toThrow(/approved locked Digital Twin/);

    const changedConfiguration = structuredClone(
      DEFAULT_EVALUATION_CONFIGURATION,
    );
    changedConfiguration.completedAt = "2026-08-29T00:00:00.000Z";
    const changedTwin = createHeldOutDigitalTwin();
    const changedTimestampResult = await runHeldOutEvaluation({
      selectionBatch: changedTwin.selectionBatch,
      oracle: changedTwin.evaluator,
      configuration: changedConfiguration,
    });
    const originalTwin = createHeldOutDigitalTwin();
    const original = await runHeldOutEvaluation({
      selectionBatch: originalTwin.selectionBatch,
      oracle: originalTwin.evaluator,
    });
    expect(changedTimestampResult.evaluationRunId).not.toBe(
      original.evaluationRunId,
    );
    expect(changedTimestampResult.completedAt).not.toBe(original.completedAt);

    const changedScoringConfiguration = structuredClone(
      DEFAULT_EVALUATION_CONFIGURATION,
    );
    changedScoringConfiguration.scoringConfig.actionPenalties.SEND_PAYMENT_LINK.operationalCostSubunits += 1;
    const scoringTwin = createHeldOutDigitalTwin();
    const changedScoringResult = await runHeldOutEvaluation({
      selectionBatch: scoringTwin.selectionBatch,
      oracle: scoringTwin.evaluator,
      configuration: changedScoringConfiguration,
    });
    expect(changedScoringResult.evaluationRunId).not.toBe(
      original.evaluationRunId,
    );
  });
});
