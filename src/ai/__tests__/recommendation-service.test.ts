import { afterEach, describe, expect, it, vi } from "vitest";

import {
  aiProviderOutputSchema,
  aiScoringResultSchema,
  type AiScoringResult,
  type SafeFallbackReason,
} from "@/ai/contracts";
import type { AiRecommendationProvider } from "@/ai/provider";
import { scoreRecoveryRecommendation } from "@/ai/recommendation-service";
import {
  defaultScoringConfig,
  providerOutput,
  scorerInput,
  scoringTime,
} from "@/ai/__tests__/fixtures";
import { aiRecommendationSchema } from "@/domain/ai";

function controlledProvider(output: unknown): AiRecommendationProvider {
  return {
    estimate: vi.fn().mockResolvedValue(output),
  };
}

function expectSafeFallback(
  result: AiScoringResult,
  reason: SafeFallbackReason,
): void {
  expect(result.status).toBe("SAFE_FALLBACK");
  if (result.status !== "SAFE_FALLBACK") {
    throw new Error("Expected a safe fallback result.");
  }
  expect(result.fallbackReason).toBe(reason);
}

describe("strict recommendation service", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns identical rankings for identical validated provider output", async () => {
    const input = scorerInput();
    const output = providerOutput();
    expect(
      await scoreRecoveryRecommendation(input, controlledProvider(output)),
    ).toEqual(
      await scoreRecoveryRecommendation(input, controlledProvider(output)),
    );
  });

  it("preserves the injected recommendation timestamp", async () => {
    const result = await scoreRecoveryRecommendation(
      scorerInput({ recommendedAt: scoringTime }),
      controlledProvider(providerOutput()),
    );
    expect(result.recommendation.recommendedAt).toBe(scoringTime);
  });

  it("uses deterministic expected value instead of provider array order", async () => {
    const result = await scoreRecoveryRecommendation(
      scorerInput(),
      controlledProvider(
        providerOutput([
          { action: "ESCALATE_HUMAN", recoveryProbabilityMillionths: 80_000 },
          {
            action: "REQUEST_METHOD_CHANGE",
            recoveryProbabilityMillionths: 570_000,
          },
          {
            action: "SEND_PAYMENT_LINK",
            recoveryProbabilityMillionths: 640_000,
          },
        ]),
      ),
    );
    expect(result.recommendation.selectedAction).toBe("SEND_PAYMENT_LINK");
  });

  it("uses expected value, probability, penalty, then canonical action order as tie-breaks", async () => {
    const zeroPenaltyConfig = {
      ...defaultScoringConfig,
      actionPenalties: Object.fromEntries(
        Object.keys(defaultScoringConfig.actionPenalties).map((action) => [
          action,
          {
            contactCostSubunits: 0,
            frictionPenaltySubunits: 0,
            duplicatePaymentRiskPenaltySubunits: 0,
            operationalCostSubunits: 0,
          },
        ]),
      ) as typeof defaultScoringConfig.actionPenalties,
    };
    const result = await scoreRecoveryRecommendation(
      scorerInput({
        candidateActions: ["ESCALATE_HUMAN", "REQUEST_METHOD_CHANGE"],
        scoringConfig: zeroPenaltyConfig,
      }),
      controlledProvider(
        providerOutput([
          { action: "ESCALATE_HUMAN", recoveryProbabilityMillionths: 500_000 },
          {
            action: "REQUEST_METHOD_CHANGE",
            recoveryProbabilityMillionths: 500_000,
          },
        ]),
      ),
    );
    expect(
      result.recommendation.rankedActions.map(({ action }) => action),
    ).toEqual(["REQUEST_METHOD_CHANGE", "ESCALATE_HUMAN"]);
  });

  it("creates contiguous ranks beginning at one", async () => {
    const result = await scoreRecoveryRecommendation(
      scorerInput(),
      controlledProvider(providerOutput()),
    );
    expect(result.recommendation.rankedActions.map(({ rank }) => rank)).toEqual(
      [1, 2, 3],
    );
  });

  it("always selects the rank-one action", async () => {
    const result = await scoreRecoveryRecommendation(
      scorerInput(),
      controlledProvider(providerOutput()),
    );
    expect(result.recommendation.selectedAction).toBe(
      result.recommendation.rankedActions[0]?.action,
    );
  });

  it("selects cancellation for late success", async () => {
    const result = await scoreRecoveryRecommendation(
      scorerInput({
        failureClass: "LATE_SUCCESS",
        candidateActions: ["CANCEL_RECOVERY_ALREADY_PAID"],
      }),
      controlledProvider(
        providerOutput([
          {
            action: "CANCEL_RECOVERY_ALREADY_PAID",
            recoveryProbabilityMillionths: 1_000_000,
          },
        ]),
      ),
    );
    expect(result.recommendation.selectedAction).toBe(
      "CANCEL_RECOVERY_ALREADY_PAID",
    );
  });

  it("selects stopping for a non-retryable diagnosis", async () => {
    const result = await scoreRecoveryRecommendation(
      scorerInput({
        failureClass: "NON_RETRYABLE",
        candidateActions: ["STOP_NON_RETRYABLE"],
      }),
      controlledProvider(
        providerOutput([
          {
            action: "STOP_NON_RETRYABLE",
            recoveryProbabilityMillionths: 1_000_000,
          },
        ]),
      ),
    );
    expect(result.recommendation.selectedAction).toBe("STOP_NON_RETRYABLE");
  });

  it.each(["AMBIGUOUS", "UNAVAILABLE"] as const)(
    "bypasses provider and escalates %s context",
    async (knowledgeStatus) => {
      const provider = controlledProvider(providerOutput());
      const result = await scoreRecoveryRecommendation(
        scorerInput({
          failureClass: "AMBIGUOUS",
          knowledgeStatus,
          candidateActions: ["ESCALATE_HUMAN"],
        }),
        provider,
      );
      expect(result).toMatchObject({
        status: "SAFE_FALLBACK",
        fallbackReason: "INSUFFICIENT_CONTEXT",
        recommendation: { selectedAction: "ESCALATE_HUMAN" },
      });
      expect(provider.estimate).not.toHaveBeenCalled();
    },
  );

  it("fails closed when provider proposes an action outside diagnosis candidates", async () => {
    const output = providerOutput([
      { action: "WAIT_FOR_RECOVERY", recoveryProbabilityMillionths: 700_000 },
      {
        action: "REQUEST_METHOD_CHANGE",
        recoveryProbabilityMillionths: 570_000,
      },
      { action: "ESCALATE_HUMAN", recoveryProbabilityMillionths: 80_000 },
    ]);
    const result = await scoreRecoveryRecommendation(
      scorerInput(),
      controlledProvider(output),
    );
    expect(result).toMatchObject({
      status: "SAFE_FALLBACK",
      fallbackReason: "NO_VALID_CANDIDATE",
    });
  });

  it("fails closed when a required candidate estimate is missing", async () => {
    const output = providerOutput([
      { action: "SEND_PAYMENT_LINK", recoveryProbabilityMillionths: 640_000 },
      {
        action: "REQUEST_METHOD_CHANGE",
        recoveryProbabilityMillionths: 570_000,
      },
    ]);
    const result = await scoreRecoveryRecommendation(
      scorerInput(),
      controlledProvider(output),
    );
    expect(result).toMatchObject({
      status: "SAFE_FALLBACK",
      fallbackReason: "NO_VALID_CANDIDATE",
    });
  });

  it("fails closed on duplicate action estimates", async () => {
    const raw = {
      ...providerOutput(),
      estimates: [
        providerOutput().estimates[0],
        providerOutput().estimates[0],
        providerOutput().estimates[2],
      ],
    };
    const result = await scoreRecoveryRecommendation(
      scorerInput(),
      controlledProvider(raw),
    );
    expect(result).toMatchObject({
      status: "SAFE_FALLBACK",
      fallbackReason: "MALFORMED_OUTPUT",
    });
  });

  it.each([
    ["unknown action", { action: "INVENTED_ACTION" }],
    ["out-of-range probability", { recoveryProbabilityMillionths: 1_000_001 }],
    ["empty reason", { reason: "" }],
    ["oversized reason", { reason: "x".repeat(1_001) }],
  ])("fails closed on %s", async (_label, estimateOverride) => {
    const base = providerOutput();
    const first = base.estimates[0];
    if (first === undefined)
      throw new Error("Expected provider fixture estimate.");
    const result = await scoreRecoveryRecommendation(
      scorerInput(),
      controlledProvider({
        ...base,
        estimates: [
          { ...first, ...estimateOverride },
          ...base.estimates.slice(1),
        ],
      }),
    );
    expect(result).toMatchObject({
      status: "SAFE_FALLBACK",
      fallbackReason: "MALFORMED_OUTPUT",
    });
  });

  it.each([
    ["amountSubunits", 999_999],
    ["currency", "USD"],
    ["recipient", "person@example.com"],
    ["apiRoute", "/v1/payment_links"],
    ["toolInstructions", "Create a link now"],
    ["idempotencyKey", "provider-controlled-key"],
  ])("rejects provider authority field %s", async (field, value) => {
    const result = await scoreRecoveryRecommendation(
      scorerInput(),
      controlledProvider({ ...providerOutput(), [field]: value }),
    );
    expect(result).toMatchObject({
      status: "SAFE_FALLBACK",
      fallbackReason: "MALFORMED_OUTPUT",
    });
  });

  it("fails closed on a malformed non-object", async () => {
    const result = await scoreRecoveryRecommendation(
      scorerInput(),
      controlledProvider("not structured output"),
    );
    expectSafeFallback(result, "MALFORMED_OUTPUT");
  });

  it("fails closed on an empty merchant explanation", async () => {
    const result = await scoreRecoveryRecommendation(
      scorerInput(),
      controlledProvider({ ...providerOutput(), merchantExplanation: "" }),
    );
    expectSafeFallback(result, "MALFORMED_OUTPUT");
  });

  it("fails closed on an oversized merchant explanation", async () => {
    const result = await scoreRecoveryRecommendation(
      scorerInput(),
      controlledProvider({
        ...providerOutput(),
        merchantExplanation: "x".repeat(501),
      }),
    );
    expectSafeFallback(result, "MALFORMED_OUTPUT");
  });

  it("rejects customer messages containing real-looking identifiers", async () => {
    const result = await scoreRecoveryRecommendation(
      scorerInput(),
      controlledProvider({
        ...providerOutput(),
        customerSafeMessage: "Please retry payment pay_secret_123.",
      }),
    );
    expectSafeFallback(result, "MALFORMED_OUTPUT");
  });

  it("ignores provider attempts to influence penalties by failing closed", async () => {
    const output = providerOutput();
    const first = output.estimates[0];
    if (first === undefined)
      throw new Error("Expected provider fixture estimate.");
    const result = await scoreRecoveryRecommendation(
      scorerInput(),
      controlledProvider({
        ...output,
        estimates: [
          { ...first, contactCostSubunits: -1 },
          ...output.estimates.slice(1),
        ],
      }),
    );
    expectSafeFallback(result, "MALFORMED_OUTPUT");
  });

  it("returns trusted-currency score breakdowns separately", async () => {
    const result = await scoreRecoveryRecommendation(
      scorerInput({ currency: "USD" }),
      controlledProvider(providerOutput()),
    );
    expect(result.status).toBe("SUCCESS");
    expect(
      result.scoreBreakdowns.every(({ currency }) => currency === "USD"),
    ).toBe(true);
    expect(result.recommendation).not.toHaveProperty("scoreBreakdowns");
  });

  it("fails closed when arithmetic exceeds the safe range", async () => {
    const unsafeConfig = structuredClone(defaultScoringConfig);
    unsafeConfig.actionPenalties.SEND_PAYMENT_LINK.contactCostSubunits =
      Number.MAX_SAFE_INTEGER;
    unsafeConfig.actionPenalties.SEND_PAYMENT_LINK.frictionPenaltySubunits =
      Number.MAX_SAFE_INTEGER;
    const result = await scoreRecoveryRecommendation(
      scorerInput({
        amountSubunits: Number.MAX_SAFE_INTEGER,
        scoringConfig: unsafeConfig,
      }),
      controlledProvider(providerOutput()),
    );
    expectSafeFallback(result, "ARITHMETIC_OUT_OF_RANGE");
  });

  it("returns safe escalation when the provider reports insufficient context", async () => {
    const result = await scoreRecoveryRecommendation(
      scorerInput(),
      controlledProvider({
        ...providerOutput(),
        contextStatus: "INSUFFICIENT",
        escalationRecommended: true,
      }),
    );
    expect(result).toMatchObject({
      status: "SAFE_FALLBACK",
      fallbackReason: "INSUFFICIENT_CONTEXT",
      recommendation: { selectedAction: "ESCALATE_HUMAN" },
    });
  });

  it("returns safe escalation for a synchronously thrown provider error", async () => {
    const secret = "provider-secret-must-not-leak";
    const provider: AiRecommendationProvider = {
      estimate() {
        throw new Error(secret);
      },
    };
    const result = await scoreRecoveryRecommendation(scorerInput(), provider);
    expectSafeFallback(result, "PROVIDER_ERROR");
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("returns safe escalation for a rejected provider promise", async () => {
    const provider: AiRecommendationProvider = {
      estimate: vi.fn().mockRejectedValue(new Error("private provider error")),
    };
    const result = await scoreRecoveryRecommendation(scorerInput(), provider);
    expectSafeFallback(result, "PROVIDER_ERROR");
  });

  it("aborts a timed-out provider and does not retry", async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;
    const provider: AiRecommendationProvider = {
      estimate: vi.fn((_input, { signal }) => {
        receivedSignal = signal;
        return new Promise(() => undefined);
      }),
    };
    const promise = scoreRecoveryRecommendation(
      scorerInput({
        scoringConfig: {
          ...defaultScoringConfig,
          providerTimeoutMilliseconds: 10,
        },
      }),
      provider,
    );
    await vi.advanceTimersByTimeAsync(11);
    const result = await promise;
    expectSafeFallback(result, "TIMEOUT");
    expect(receivedSignal?.aborted).toBe(true);
    expect(provider.estimate).toHaveBeenCalledTimes(1);
  });

  it("validates every fallback through the canonical recommendation schema", async () => {
    const result = await scoreRecoveryRecommendation(
      scorerInput(),
      controlledProvider(null),
    );
    expect(aiScoringResultSchema.safeParse(result).success).toBe(true);
    expect(
      aiRecommendationSchema.safeParse(result.recommendation).success,
    ).toBe(true);
    expect(result.recommendation).toMatchObject({
      selectedAction: "ESCALATE_HUMAN",
      contextStatus: "INSUFFICIENT",
      escalationRecommended: true,
    });
  });

  it("provider output schema itself rejects duplicate estimates", () => {
    const output = providerOutput();
    expect(
      aiProviderOutputSchema.safeParse({
        ...output,
        estimates: [output.estimates[0], output.estimates[0]],
      }).success,
    ).toBe(false);
  });
});
