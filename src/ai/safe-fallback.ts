import {
  aiScoringResultSchema,
  type AiScoringResult,
  type SafeFallbackReason,
} from "@/ai/contracts";

const FALLBACK_EVIDENCE: Record<
  SafeFallbackReason,
  { code: string; detail: string }
> = {
  TIMEOUT: {
    code: "AI_PROVIDER_TIMEOUT",
    detail: "The bounded recommendation wait expired and failed closed.",
  },
  MALFORMED_OUTPUT: {
    code: "AI_OUTPUT_REJECTED",
    detail: "The untrusted recommendation output did not pass validation.",
  },
  PROVIDER_ERROR: {
    code: "AI_PROVIDER_UNAVAILABLE",
    detail: "The recommendation provider was unavailable and failed closed.",
  },
  INSUFFICIENT_CONTEXT: {
    code: "AI_CONTEXT_INSUFFICIENT",
    detail: "The available context requires bounded human review.",
  },
  NO_VALID_CANDIDATE: {
    code: "AI_CANDIDATE_SET_REJECTED",
    detail: "No complete valid estimate set was available for ranking.",
  },
  ARITHMETIC_OUT_OF_RANGE: {
    code: "AI_SCORING_RANGE_REJECTED",
    detail: "Expected-value arithmetic could not be represented safely.",
  },
};

export function createSafeFallback(
  caseId: string,
  recommendedAt: string,
  fallbackReason: SafeFallbackReason,
): AiScoringResult {
  const evidence = FALLBACK_EVIDENCE[fallbackReason];
  const reason =
    "Recommendation scoring failed closed; no financial action is authorized.";

  return aiScoringResultSchema.parse({
    status: "SAFE_FALLBACK",
    fallbackReason,
    recommendation: {
      caseId,
      rankedActions: [
        {
          rank: 1,
          action: "ESCALATE_HUMAN",
          recoveryProbability: 0,
          reason,
          evidence: [evidence],
        },
      ],
      selectedAction: "ESCALATE_HUMAN",
      confidence: 0,
      merchantExplanation:
        "RecoverAI stopped at the recommendation boundary and requires human review.",
      reason,
      evidence: [evidence],
      contextStatus: "INSUFFICIENT",
      escalationRecommended: true,
      recommendedAt,
    },
    scoreBreakdowns: [],
  });
}
