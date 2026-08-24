import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { AiScoringResult } from "@/ai/contracts";
import { createSafeFallback } from "@/ai/safe-fallback";
import type { PolicyFirewallResult } from "@/policy/contracts";
import { evaluateRecoveryPolicy } from "@/policy/firewall";
import { POLICY_RULE_ORDER } from "@/policy/rules";
import {
  policyEvaluationTime,
  policyInput,
  scoringResultFor,
} from "@/policy/__tests__/fixtures";
import { policyDecisionSchema } from "@/domain/policy";
import { caseIdSchema, paymentIdSchema } from "@/domain/primitives";

function decision(result: PolicyFirewallResult) {
  expect(result.status).toBe("DECIDED");
  if (result.status !== "DECIDED") throw new Error("Expected decision");
  return result.decision;
}

describe("AI and deterministic diagnosis boundaries", () => {
  it("escalates a proactive recommendation below minimum confidence", () => {
    const input = policyInput();
    input.aiScoringResult = scoringResultFor("WAIT_FOR_RECOVERY", {
      confidence: 0.699_999,
    });
    expect(decision(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "ESCALATED",
      ruleId: "AI_RECOMMENDATION_BOUNDARY",
    });
  });

  it("lets confidence exactly 0.70 pass", () => {
    const input = policyInput();
    input.aiScoringResult = scoringResultFor("WAIT_FOR_RECOVERY", {
      confidence: 0.7,
    });
    expect(decision(evaluateRecoveryPolicy(input)).outcome).toBe("APPROVED");
  });

  it("conservatively rejects confidence infinitesimally below 0.70", () => {
    const input = policyInput();
    input.aiScoringResult = scoringResultFor("WAIT_FOR_RECOVERY", {
      confidence: 0.699_999_9,
    });
    expect(decision(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "ESCALATED",
      ruleId: "AI_RECOMMENDATION_BOUNDARY",
    });
  });

  it("turns an AI safe fallback into human escalation", () => {
    const input = policyInput("ESCALATE_HUMAN");
    input.aiScoringResult = createSafeFallback(
      input.caseRecord.caseId,
      policyEvaluationTime,
      "TIMEOUT",
    );
    expect(decision(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "ESCALATED",
      finalAction: "ESCALATE_HUMAN",
    });
  });

  it("turns insufficient context into human escalation", () => {
    const input = policyInput("ESCALATE_HUMAN");
    expect(input.aiScoringResult.recommendation.contextStatus).toBe(
      "INSUFFICIENT",
    );
    expect(decision(evaluateRecoveryPolicy(input)).outcome).toBe("ESCALATED");
  });

  it("blocks a selected action that differs from the intent", () => {
    const input = policyInput();
    input.intent = { action: "STOP_NON_RETRYABLE" };
    expect(decision(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "BLOCKED",
      ruleId: "INPUT_IDENTITY_INTEGRITY",
    });
  });

  it("blocks a recommendation belonging to another case", () => {
    const input = policyInput();
    input.aiScoringResult.recommendation.caseId =
      caseIdSchema.parse("case_other_001");
    expect(decision(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "BLOCKED",
      ruleId: "INPUT_IDENTITY_INTEGRITY",
    });
  });

  it("blocks a payment reference belonging to another payment", () => {
    const input = policyInput();
    input.paymentContext.paymentId = paymentIdSchema.parse("pay_other_001");
    expect(decision(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "BLOCKED",
      ruleId: "INPUT_IDENTITY_INTEGRITY",
    });
  });

  it("blocks inconsistent trusted contact counts", () => {
    const input = policyInput();
    input.paymentContext.previousContactCount = 1;
    expect(decision(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "BLOCKED",
      ruleId: "INPUT_IDENTITY_INTEGRITY",
    });
  });

  it("escalates conflicting trusted case and payment money", () => {
    const input = policyInput();
    input.paymentContext.money.amountSubunits = 100_001;
    expect(decision(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "ESCALATED",
      ruleId: "PAYMENT_STATE_CONFLICT",
    });
  });

  it("blocks duplicate selected-action score breakdowns", () => {
    const input = policyInput();
    if (input.aiScoringResult.status !== "SUCCESS")
      throw new Error("Expected score");
    input.aiScoringResult.scoreBreakdowns.push({
      ...input.aiScoringResult.scoreBreakdowns[0]!,
    });
    expect(decision(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "BLOCKED",
      ruleId: "INPUT_IDENTITY_INTEGRITY",
    });
  });

  it("escalates a selected action outside diagnosis candidates", () => {
    const input = policyInput();
    input.diagnosis.candidateActions = ["ESCALATE_HUMAN"];
    expect(decision(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "ESCALATED",
      ruleId: "AI_RECOMMENDATION_BOUNDARY",
    });
  });

  it("fails closed on a malformed recommendation", () => {
    const raw = structuredClone(policyInput());
    (raw as unknown as Record<string, unknown>).aiScoringResult = {
      status: "SUCCESS",
      recommendation: "malformed",
    };
    expect(evaluateRecoveryPolicy(raw)).toMatchObject({
      status: "INVALID_INPUT",
      errorCode: "POLICY_INPUT_INVALID",
    });
  });

  it("does not let a non-retryable diagnosis send a link", () => {
    const input = policyInput("SEND_PAYMENT_LINK");
    input.diagnosis.failureClass = "NON_RETRYABLE";
    input.diagnosis.candidateActions = ["SEND_PAYMENT_LINK"];
    expect(decision(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "ESCALATED",
      ruleId: "DIAGNOSIS_ACTION_COMPATIBILITY",
    });
  });

  it("does not let a late-success diagnosis start proactive recovery", () => {
    const input = policyInput();
    input.diagnosis.failureClass = "LATE_SUCCESS";
    input.diagnosis.candidateActions = ["WAIT_FOR_RECOVERY"];
    expect(decision(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "ESCALATED",
      ruleId: "DIAGNOSIS_ACTION_COMPATIBILITY",
    });
  });

  it("does not approve proactive recovery for an ambiguous diagnosis", () => {
    const input = policyInput();
    input.diagnosis.failureClass = "AMBIGUOUS";
    input.diagnosis.knowledgeStatus = "AMBIGUOUS";
    input.diagnosis.candidateActions = ["WAIT_FOR_RECOVERY"];
    expect(decision(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "ESCALATED",
      ruleId: "DIAGNOSIS_ACTION_COMPATIBILITY",
    });
  });
});

describe("expected-value firewall", () => {
  it("allows a positive internally consistent expected value", () => {
    expect(decision(evaluateRecoveryPolicy(policyInput())).outcome).toBe(
      "APPROVED",
    );
  });

  it("stops a negative expected-value proactive action", () => {
    const input = policyInput();
    if (input.aiScoringResult.status !== "SUCCESS")
      throw new Error("Expected score");
    const ranked = input.aiScoringResult.recommendation.rankedActions[0];
    const breakdown = input.aiScoringResult.scoreBreakdowns[0];
    if (ranked === undefined || breakdown === undefined)
      throw new Error("Expected values");
    ranked.recoveryProbability = 0;
    breakdown.recoveryProbabilityMillionths = 0;
    breakdown.expectedRecoveredSubunits = 0;
    breakdown.expectedValueSubunits = -100;
    expect(decision(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "STOPPED",
      finalAction: "STOP_NON_RETRYABLE",
      ruleId: "EXPECTED_VALUE_POSITIVE",
    });
  });

  it("stops a zero expected-value proactive action", () => {
    const input = policyInput();
    if (input.aiScoringResult.status !== "SUCCESS")
      throw new Error("Expected score");
    const ranked = input.aiScoringResult.recommendation.rankedActions[0];
    const breakdown = input.aiScoringResult.scoreBreakdowns[0];
    if (ranked === undefined || breakdown === undefined)
      throw new Error("Expected values");
    ranked.recoveryProbability = 0.001;
    breakdown.recoveryProbabilityMillionths = 1_000;
    breakdown.expectedRecoveredSubunits = 100;
    breakdown.expectedValueSubunits = 0;
    expect(decision(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "STOPPED",
      ruleId: "EXPECTED_VALUE_POSITIVE",
    });
  });

  it("blocks a score breakdown paired with the wrong action", () => {
    const input = policyInput();
    input.aiScoringResult = scoringResultFor("WAIT_FOR_RECOVERY", {
      breakdownAction: "SEND_PAYMENT_LINK",
    });
    expect(decision(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "BLOCKED",
      ruleId: "INPUT_IDENTITY_INTEGRITY",
    });
  });

  it("blocks a missing selected-action breakdown", () => {
    const input = policyInput();
    if (input.aiScoringResult.status !== "SUCCESS")
      throw new Error("Expected score");
    input.aiScoringResult.scoreBreakdowns = [
      {
        ...input.aiScoringResult.scoreBreakdowns[0]!,
        action: "ESCALATE_HUMAN",
      },
    ];
    expect(decision(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "BLOCKED",
      ruleId: "INPUT_IDENTITY_INTEGRITY",
    });
  });

  it.each([
    ["penalty total", { totalPenaltySubunits: 101 }],
    ["expected recovered", { expectedRecoveredSubunits: 79_999 }],
    ["expected value", { expectedValueSubunits: 79_899 }],
    ["probability", { recoveryProbabilityMillionths: 799_999 }],
  ])("escalates inconsistent %s", (_label, override) => {
    const input = policyInput();
    if (input.aiScoringResult.status !== "SUCCESS")
      throw new Error("Expected score");
    input.aiScoringResult.scoreBreakdowns[0] = {
      ...input.aiScoringResult.scoreBreakdowns[0]!,
      ...override,
    };
    expect(decision(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "ESCALATED",
      ruleId: "EXPECTED_VALUE_POSITIVE",
    });
  });
});

describe("policy output semantics, determinism, and purity", () => {
  it.each([
    ["WAIT_FOR_RECOVERY", "APPROVED", "WAIT_FOR_RECOVERY"],
    ["SEND_PAYMENT_LINK", "APPROVED", "SEND_PAYMENT_LINK"],
    ["REQUEST_METHOD_CHANGE", "APPROVED", "REQUEST_METHOD_CHANGE"],
    ["STOP_NON_RETRYABLE", "STOPPED", "STOP_NON_RETRYABLE"],
    ["ESCALATE_HUMAN", "ESCALATED", "ESCALATE_HUMAN"],
  ] as const)(
    "%s produces valid %s semantics",
    (action, outcome, finalAction) => {
      const result = decision(evaluateRecoveryPolicy(policyInput(action)));
      expect(result).toMatchObject({ outcome, finalAction });
      expect(policyDecisionSchema.safeParse(result).success).toBe(true);
    },
  );

  it("BLOCKED has no final action", () => {
    const input = policyInput();
    input.intent = { action: "STOP_NON_RETRYABLE" };
    const result = decision(evaluateRecoveryPolicy(input));
    expect(result.outcome).toBe("BLOCKED");
    expect(result).not.toHaveProperty("finalAction");
  });

  it("returns checks in fixed deterministic precedence order", () => {
    const result = decision(evaluateRecoveryPolicy(policyInput()));
    expect(result.checksPerformed.map(({ ruleId }) => ruleId)).toEqual(
      POLICY_RULE_ORDER,
    );
  });

  it("includes the exact primary rule once in checks", () => {
    const result = decision(evaluateRecoveryPolicy(policyInput()));
    expect(
      result.checksPerformed.filter(({ ruleId }) => ruleId === result.ruleId),
    ).toHaveLength(1);
  });

  it("returns byte-equivalent logical output for the same input and timestamp", () => {
    const input = policyInput();
    expect(evaluateRecoveryPolicy(input)).toEqual(
      evaluateRecoveryPolicy(input),
    );
  });

  it("does not mutate rejected input", () => {
    const input = policyInput("SEND_PAYMENT_LINK");
    if (input.intent.action !== "SEND_PAYMENT_LINK")
      throw new Error("Expected intent");
    input.intent.intendedAmountSubunits = 1_000_000;
    const before = structuredClone(input);
    evaluateRecoveryPolicy(input);
    expect(input).toEqual(before);
  });

  it("validates every output through the strict result schema", async () => {
    const { policyFirewallResultSchema } = await import("@/policy/contracts");
    const inputs = [
      policyInput(),
      policyInput("SEND_PAYMENT_LINK"),
      policyInput("STOP_NON_RETRYABLE"),
      policyInput("ESCALATE_HUMAN"),
    ];
    for (const input of inputs) {
      expect(
        policyFirewallResultSchema.safeParse(evaluateRecoveryPolicy(input))
          .success,
      ).toBe(true);
    }
  });

  it("keeps the firewall independent from UI, network, repositories, clock, and randomness", () => {
    const files = ["config.ts", "contracts.ts", "firewall.ts", "rules.ts"];
    const source = files
      .map((name) =>
        readFileSync(join(process.cwd(), "src/policy", name), "utf8"),
      )
      .join("\n");
    expect(source).not.toMatch(/from ["'](?:next|react|@\/components)/);
    expect(source).not.toContain("@/repositories/sqlite");
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("process.env");
    expect(source).not.toContain("Math.random");
    expect(source).not.toContain("Date.now");
  });

  it("does not expose scorer raw errors in policy output", () => {
    const input = policyInput("ESCALATE_HUMAN");
    input.aiScoringResult = createSafeFallback(
      input.caseRecord.caseId,
      policyEvaluationTime,
      "PROVIDER_ERROR",
    );
    expect(JSON.stringify(evaluateRecoveryPolicy(input))).not.toContain(
      "provider-secret",
    );
  });

  it("accepts a structurally identical scoring result without persistence", () => {
    const input = policyInput();
    input.aiScoringResult = structuredClone(
      input.aiScoringResult,
    ) as AiScoringResult;
    expect(decision(evaluateRecoveryPolicy(input)).outcome).toBe("APPROVED");
  });
});
