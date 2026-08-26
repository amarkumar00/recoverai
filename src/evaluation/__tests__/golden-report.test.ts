import { describe, expect, it } from "vitest";

import goldenReportJson from "../../../docs/evaluation/golden-report.json";

import { createHeldOutDigitalTwin } from "@/digital-twin/evaluator-only";
import { goldenEvaluationReportSchema } from "@/evaluation/contracts";
import { createGoldenEvaluationReport } from "@/evaluation/report";
import { runHeldOutEvaluation } from "@/evaluation/runner";

describe("machine-valid golden evaluation report", () => {
  it("validates strictly and exactly matches a regenerated locked run", async () => {
    const committed = goldenEvaluationReportSchema.parse(goldenReportJson);
    const twin = createHeldOutDigitalTwin();
    const regenerated = createGoldenEvaluationReport(
      await runHeldOutEvaluation({
        selectionBatch: twin.selectionBatch,
        oracle: twin.evaluator,
      }),
    );

    expect(committed).toEqual(regenerated);
  });

  it("labels every financial claim simulated and contains no hidden outcome table, obvious PII, or credential material", () => {
    const serialized = JSON.stringify(goldenReportJson);
    expect(goldenReportJson.simulationLabel).toBe("SIMULATED");
    expect(goldenReportJson.result.simulationLabel).toBe("SIMULATED");
    expect(serialized).not.toContain("hiddenSimulatedOutcomeByAction");
    expect(serialized).not.toContain("groundTruthAllowedActions");
    expect(serialized).not.toMatch(
      /(?:rzp_(?:test|live)|razorpay_(?:key|secret)|bearer\s|api[_-]?secret)/i,
    );
    expect(serialized).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  });
});
