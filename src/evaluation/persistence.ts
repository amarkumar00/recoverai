import type { DigitalTwinSelectionBatch } from "@/digital-twin/contracts";
import type { EvaluationConfiguration } from "@/evaluation/contracts";
import {
  runHeldOutEvaluation,
  type SelectedOutcomeOracle,
} from "@/evaluation/runner";
import type { EvaluationRunRecord } from "@/repositories/contracts";
import type { EvaluationRunRepository } from "@/repositories/interfaces";

export async function runAndPersistHeldOutEvaluation(input: {
  selectionBatch: DigitalTwinSelectionBatch;
  oracle: SelectedOutcomeOracle;
  repository: EvaluationRunRepository;
  configuration?: EvaluationConfiguration;
}): Promise<EvaluationRunRecord> {
  const result = await runHeldOutEvaluation({
    selectionBatch: input.selectionBatch,
    oracle: input.oracle,
    ...(input.configuration === undefined
      ? {}
      : { configuration: input.configuration }),
  });
  return input.repository.insert({
    result,
    createdAt: result.completedAt,
  });
}
