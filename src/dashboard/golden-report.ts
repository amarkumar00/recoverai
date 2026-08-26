import "server-only";

import goldenReportJson from "../../docs/evaluation/golden-report.json";

import { LOCKED_DEFAULT_HELD_OUT_FINGERPRINT_SHA256 } from "@/digital-twin/contracts";
import {
  goldenEvaluationReportSchema,
  type GoldenEvaluationReport,
} from "@/evaluation/contracts";

export class GoldenReportUnavailableError extends Error {
  constructor() {
    super("The validated simulated evaluation report is unavailable.");
    this.name = "GoldenReportUnavailableError";
  }
}

export function loadValidatedGoldenReport(): GoldenEvaluationReport {
  const parsed = goldenEvaluationReportSchema.safeParse(goldenReportJson);
  if (
    !parsed.success ||
    parsed.data.result.datasetFingerprintSha256 !==
      LOCKED_DEFAULT_HELD_OUT_FINGERPRINT_SHA256
  ) {
    throw new GoldenReportUnavailableError();
  }
  return parsed.data;
}
