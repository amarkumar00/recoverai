import {
  aiProviderInputSchema,
  aiProviderOutputSchema,
  aiScorerInputSchema,
  aiScoringResultSchema,
  PROBABILITY_SCALE_MILLIONTHS,
  type ActionScoreBreakdown,
  type AiProviderInput,
  type AiProviderOutput,
  type AiScorerInput,
  type AiScoringResult,
} from "@/ai/contracts";
import {
  ArithmeticOutOfRangeError,
  calculateExpectedValue,
} from "@/ai/expected-value";
import type { AiRecommendationProvider } from "@/ai/provider";
import { createSafeFallback } from "@/ai/safe-fallback";
import { RECOVERY_ACTIONS, type RecoveryAction } from "@/domain/actions";
import { aiRecommendationSchema } from "@/domain/ai";

class ProviderTimeoutError extends Error {}

export function createProviderInput(input: AiScorerInput): AiProviderInput {
  return aiProviderInputSchema.parse({
    caseId: input.caseId,
    seed: input.seed,
    failureClass: input.diagnosis.failureClass,
    knowledgeStatus: input.diagnosis.knowledgeStatus,
    candidateActions: input.diagnosis.candidateActions,
    previousContactCount: input.paymentContext.previousContactCount,
    activeRecoveryLinkExists: input.paymentContext.activeRecoveryLink.exists,
    paymentMethod: input.paymentContext.method,
  });
}

async function invokeProvider(
  provider: AiRecommendationProvider,
  input: AiProviderInput,
  timeoutMilliseconds: number,
): Promise<unknown> {
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const providerPromise = Promise.resolve().then(() =>
    provider.estimate(input, { signal: controller.signal }),
  );
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(new ProviderTimeoutError());
    }, timeoutMilliseconds);
  });

  try {
    return await Promise.race([providerPromise, timeoutPromise]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

function hasExactCandidateSet(
  output: AiProviderOutput,
  candidateActions: readonly RecoveryAction[],
): boolean {
  if (output.estimates.length !== candidateActions.length) {
    return false;
  }
  const candidates = new Set(candidateActions);
  return output.estimates.every((estimate) => candidates.has(estimate.action));
}

function canonicalActionIndex(action: RecoveryAction): number {
  return RECOVERY_ACTIONS.indexOf(action);
}

function rankBreakdowns(
  breakdowns: ActionScoreBreakdown[],
): ActionScoreBreakdown[] {
  return [...breakdowns].sort((left, right) => {
    if (left.expectedValueSubunits !== right.expectedValueSubunits) {
      return left.expectedValueSubunits > right.expectedValueSubunits ? -1 : 1;
    }
    if (
      left.recoveryProbabilityMillionths !== right.recoveryProbabilityMillionths
    ) {
      return (
        right.recoveryProbabilityMillionths - left.recoveryProbabilityMillionths
      );
    }
    if (left.totalPenaltySubunits !== right.totalPenaltySubunits) {
      return left.totalPenaltySubunits - right.totalPenaltySubunits;
    }
    return (
      canonicalActionIndex(left.action) - canonicalActionIndex(right.action)
    );
  });
}

function createSuccessfulResult(
  input: AiScorerInput,
  output: AiProviderOutput,
): AiScoringResult {
  const estimatesByAction = new Map(
    output.estimates.map((estimate) => [estimate.action, estimate]),
  );
  const breakdowns = output.estimates.map((estimate) =>
    calculateExpectedValue({
      action: estimate.action,
      amountSubunits: input.paymentContext.money.amountSubunits,
      currency: input.paymentContext.money.currency,
      recoveryProbabilityMillionths: estimate.recoveryProbabilityMillionths,
      penalties: input.scoringConfig.actionPenalties[estimate.action],
    }),
  );
  const rankedBreakdowns = rankBreakdowns(breakdowns);
  const top = rankedBreakdowns[0];
  if (top === undefined) {
    return createSafeFallback(
      input.caseId,
      input.recommendedAt,
      "NO_VALID_CANDIDATE",
    );
  }

  const rankedActions = rankedBreakdowns.map((breakdown, index) => {
    const estimate = estimatesByAction.get(breakdown.action);
    if (estimate === undefined) {
      throw new Error("Validated estimate lookup failed.");
    }
    return {
      rank: index + 1,
      action: breakdown.action,
      recoveryProbability:
        estimate.recoveryProbabilityMillionths / PROBABILITY_SCALE_MILLIONTHS,
      reason: estimate.reason,
      evidence: estimate.evidence,
    };
  });
  const topEstimate = estimatesByAction.get(top.action);
  if (topEstimate === undefined) {
    throw new Error("Validated top estimate lookup failed.");
  }

  const recommendation = aiRecommendationSchema.parse({
    caseId: input.caseId,
    rankedActions,
    selectedAction: top.action,
    confidence: output.confidenceMillionths / PROBABILITY_SCALE_MILLIONTHS,
    merchantExplanation: `${top.action} ranked first after trusted expected-value scoring for the diagnosed ${input.diagnosis.failureClass} context.`,
    ...(output.customerSafeMessage === undefined
      ? {}
      : { customerSafeMessage: output.customerSafeMessage }),
    reason: topEstimate.reason,
    evidence: topEstimate.evidence,
    contextStatus: "SUFFICIENT",
    escalationRecommended:
      output.escalationRecommended || top.action === "ESCALATE_HUMAN",
    recommendedAt: input.recommendedAt,
  });

  return aiScoringResultSchema.parse({
    status: "SUCCESS",
    recommendation,
    scoreBreakdowns: rankedBreakdowns,
  });
}

export async function scoreRecoveryRecommendation(
  rawInput: AiScorerInput,
  provider: AiRecommendationProvider,
): Promise<AiScoringResult> {
  const input = aiScorerInputSchema.parse(rawInput);

  if (
    input.diagnosis.knowledgeStatus !== "KNOWN" ||
    (input.diagnosis.candidateActions.length === 1 &&
      input.diagnosis.candidateActions[0] === "ESCALATE_HUMAN")
  ) {
    return createSafeFallback(
      input.caseId,
      input.recommendedAt,
      "INSUFFICIENT_CONTEXT",
    );
  }
  if (input.diagnosis.candidateActions.length === 0) {
    return createSafeFallback(
      input.caseId,
      input.recommendedAt,
      "NO_VALID_CANDIDATE",
    );
  }

  let rawOutput: unknown;
  try {
    rawOutput = await invokeProvider(
      provider,
      createProviderInput(input),
      input.scoringConfig.providerTimeoutMilliseconds,
    );
  } catch (error) {
    return createSafeFallback(
      input.caseId,
      input.recommendedAt,
      error instanceof ProviderTimeoutError ? "TIMEOUT" : "PROVIDER_ERROR",
    );
  }

  const parsedOutput = aiProviderOutputSchema.safeParse(rawOutput);
  if (!parsedOutput.success) {
    return createSafeFallback(
      input.caseId,
      input.recommendedAt,
      "MALFORMED_OUTPUT",
    );
  }
  if (parsedOutput.data.contextStatus === "INSUFFICIENT") {
    return createSafeFallback(
      input.caseId,
      input.recommendedAt,
      "INSUFFICIENT_CONTEXT",
    );
  }
  if (
    !hasExactCandidateSet(parsedOutput.data, input.diagnosis.candidateActions)
  ) {
    return createSafeFallback(
      input.caseId,
      input.recommendedAt,
      "NO_VALID_CANDIDATE",
    );
  }

  try {
    return createSuccessfulResult(input, parsedOutput.data);
  } catch (error) {
    return createSafeFallback(
      input.caseId,
      input.recommendedAt,
      error instanceof ArithmeticOutOfRangeError
        ? "ARITHMETIC_OUT_OF_RANGE"
        : "MALFORMED_OUTPUT",
    );
  }
}
