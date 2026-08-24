import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { aiProviderInputSchema, aiProviderOutputSchema } from "@/ai/contracts";
import {
  DETERMINISTIC_MOCK_PROVIDER_DESCRIPTION,
  DeterministicMockAiProvider,
} from "@/ai/mock-provider";
import { createProviderInput } from "@/ai/recommendation-service";
import { scorerInput } from "@/ai/__tests__/fixtures";

const provider = new DeterministicMockAiProvider();

async function estimate(input = scorerInput()) {
  return aiProviderOutputSchema.parse(
    await provider.estimate(createProviderInput(input), {
      signal: new AbortController().signal,
    }),
  );
}

describe("deterministic mock AI provider", () => {
  it("returns identical logical output for the same seed and context", async () => {
    expect(await estimate()).toEqual(await estimate());
  });

  it("is unaffected by changed global current time", async () => {
    const first = await estimate();
    const originalNow = Date.now;
    Date.now = () => 1;
    try {
      expect(await estimate()).toEqual(first);
    } finally {
      Date.now = originalNow;
    }
  });

  it("does not depend on Math.random", async () => {
    const first = await estimate();
    const originalRandom = Math.random;
    Math.random = () => 0.999;
    try {
      expect(await estimate()).toEqual(first);
    } finally {
      Math.random = originalRandom;
    }
  });

  it("uses a bounded deterministic seed variation", async () => {
    const first = await estimate(scorerInput({ seed: "seed-one" }));
    const second = await estimate(scorerInput({ seed: "seed-two" }));
    expect(first.estimates).not.toEqual(second.estimates);
    for (const estimate of second.estimates) {
      expect(estimate.recoveryProbabilityMillionths).toBeGreaterThanOrEqual(0);
      expect(estimate.recoveryProbabilityMillionths).toBeLessThanOrEqual(
        1_000_000,
      );
    }
  });

  it("estimates only deterministic diagnosis candidates", async () => {
    const output = await estimate();
    expect(output.estimates.map(({ action }) => action)).toEqual(
      scorerInput().diagnosis.candidateActions,
    );
  });

  it("usually favours waiting for downtime", async () => {
    const output = await estimate(
      scorerInput({
        failureClass: "DOWNTIME_OR_TRANSIENT",
        candidateActions: ["WAIT_FOR_RECOVERY", "ESCALATE_HUMAN"],
      }),
    );
    expect(output.estimates[0]?.action).toBe("WAIT_FOR_RECOVERY");
    expect(output.estimates[0]?.recoveryProbabilityMillionths).toBeGreaterThan(
      output.estimates[1]?.recoveryProbabilityMillionths ?? 1_000_000,
    );
  });

  it("favours method change for insufficient funds", async () => {
    const output = await estimate(
      scorerInput({
        failureClass: "INSUFFICIENT_FUNDS",
        candidateActions: [
          "REQUEST_METHOD_CHANGE",
          "SEND_PAYMENT_LINK",
          "ESCALATE_HUMAN",
        ],
      }),
    );
    const probabilities = Object.fromEntries(
      output.estimates.map((item) => [
        item.action,
        item.recoveryProbabilityMillionths,
      ]),
    );
    expect(probabilities.REQUEST_METHOD_CHANGE).toBeGreaterThan(
      probabilities.SEND_PAYMENT_LINK ?? 1_000_000,
    );
  });

  it("uses exact terminal estimates for late success", async () => {
    const output = await estimate(
      scorerInput({
        failureClass: "LATE_SUCCESS",
        candidateActions: ["CANCEL_RECOVERY_ALREADY_PAID"],
      }),
    );
    expect(output.estimates).toMatchObject([
      {
        action: "CANCEL_RECOVERY_ALREADY_PAID",
        recoveryProbabilityMillionths: 0,
      },
    ]);
  });

  it("uses exact terminal estimates for non-retryable cases", async () => {
    const output = await estimate(
      scorerInput({
        failureClass: "NON_RETRYABLE",
        candidateActions: ["STOP_NON_RETRYABLE"],
      }),
    );
    expect(output.estimates[0]).toMatchObject({
      action: "STOP_NON_RETRYABLE",
      recoveryProbabilityMillionths: 0,
    });
  });

  it("contains no money, identity, route, or hidden-outcome fields", () => {
    const input = createProviderInput(scorerInput());
    expect(aiProviderInputSchema.parse(input)).toEqual(input);
    expect(input).not.toHaveProperty("money");
    expect(input).not.toHaveProperty("currency");
    expect(input).not.toHaveProperty("syntheticCustomerHash");
    expect(input).not.toHaveProperty("paymentId");
    expect(input).not.toHaveProperty("orderId");
    expect(input).not.toHaveProperty("simulatedOutcomeByAction");
  });

  it("uses customer-safe templates without identifiers or contact details", async () => {
    const output = await estimate();
    const message = output.customerSafeMessage ?? "";
    expect(message).not.toMatch(/(?:pay|order|case|customer)_/i);
    expect(message).not.toContain("a".repeat(64));
    expect(message).not.toMatch(/@|\+?\d{10,}/);
  });

  it("clearly identifies itself as a demo test double, not a trained model", () => {
    expect(DETERMINISTIC_MOCK_PROVIDER_DESCRIPTION).toContain(
      "demo/test double",
    );
    expect(DETERMINISTIC_MOCK_PROVIDER_DESCRIPTION).toContain("not a trained");
  });

  it("keeps the AI boundary independent from UI, framework, persistence, Razorpay, and credentials", () => {
    const moduleNames = [
      "contracts.ts",
      "expected-value.ts",
      "mock-provider.ts",
      "provider.ts",
      "recommendation-service.ts",
      "safe-fallback.ts",
    ];
    const source = moduleNames
      .map((name) => readFileSync(join(process.cwd(), "src/ai", name), "utf8"))
      .join("\n");

    expect(source).not.toMatch(
      /from ["'](?:next|react|@\/components|@\/repositories|razorpay)/,
    );
    expect(source).not.toContain("process.env");
    expect(source).not.toContain("fetch(");
  });
});
