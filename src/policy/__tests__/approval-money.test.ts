import { describe, expect, it } from "vitest";

import { evaluateRecoveryPolicy } from "@/policy/firewall";
import {
  policyEvaluationTime,
  policyInput,
  policyWindowEnd,
  scoringResultFor,
} from "@/policy/__tests__/fixtures";
import type { PolicyFirewallResult } from "@/policy/contracts";

function expectDecision(
  result: PolicyFirewallResult,
  outcome: "APPROVED" | "BLOCKED" | "ESCALATED" | "STOPPED",
) {
  expect(result.status).toBe("DECIDED");
  if (result.status !== "DECIDED") throw new Error("Expected policy decision");
  expect(result.decision.outcome).toBe(outcome);
  return result.decision;
}

describe("approved actions and money integrity", () => {
  it("approves a safe bounded wait", () => {
    const decision = expectDecision(
      evaluateRecoveryPolicy(policyInput("WAIT_FOR_RECOVERY")),
      "APPROVED",
    );
    expect(decision.finalAction).toBe("WAIT_FOR_RECOVERY");
  });

  it("approves a safe exact-money Payment Link intent", () => {
    const decision = expectDecision(
      evaluateRecoveryPolicy(policyInput("SEND_PAYMENT_LINK")),
      "APPROVED",
    );
    expect(decision.finalAction).toBe("SEND_PAYMENT_LINK");
  });

  it("approves a safe method-change intent", () => {
    const decision = expectDecision(
      evaluateRecoveryPolicy(policyInput("REQUEST_METHOD_CHANGE")),
      "APPROVED",
    );
    expect(decision.finalAction).toBe("REQUEST_METHOD_CHANGE");
  });

  it("turns a compatible non-retryable stop intent into STOPPED", () => {
    const decision = expectDecision(
      evaluateRecoveryPolicy(policyInput("STOP_NON_RETRYABLE")),
      "STOPPED",
    );
    expect(decision.finalAction).toBe("STOP_NON_RETRYABLE");
  });

  it("turns human escalation intent into ESCALATED", () => {
    const decision = expectDecision(
      evaluateRecoveryPolicy(policyInput("ESCALATE_HUMAN")),
      "ESCALATED",
    );
    expect(decision.finalAction).toBe("ESCALATE_HUMAN");
  });

  it("allows confidence exactly at 0.70", () => {
    const input = policyInput();
    input.aiScoringResult = scoringResultFor("WAIT_FOR_RECOVERY", {
      confidence: 0.7,
    });
    expectDecision(evaluateRecoveryPolicy(input), "APPROVED");
  });

  it("treats the exact 24-hour boundary as inclusive", () => {
    const input = policyInput();
    input.evaluatedAt = policyWindowEnd;
    expectDecision(evaluateRecoveryPolicy(input), "APPROVED");
  });

  it.each([
    ["ten-times amount", 1_000_000, "INR"],
    ["one-subunit amount mismatch", 100_001, "INR"],
    ["currency mismatch", 100_000, "USD"],
  ])("escalates %s", (_label, amount, currency) => {
    const input = policyInput("SEND_PAYMENT_LINK");
    if (input.intent.action !== "SEND_PAYMENT_LINK")
      throw new Error("Expected link intent");
    input.intent.intendedAmountSubunits = amount;
    input.intent.intendedCurrency = currency;
    const decision = expectDecision(evaluateRecoveryPolicy(input), "ESCALATED");
    expect(decision.ruleId).toBe("INTENT_MONEY_INTEGRITY");
    expect(decision.finalAction).toBe("ESCALATE_HUMAN");
  });

  it.each([
    ["zero amount", 0],
    ["negative amount", -1],
    ["fractional amount", 100_000.5],
    ["unsafe amount", Number.MAX_SAFE_INTEGER + 1],
  ])("fails closed for %s", (_label, amount) => {
    const raw = structuredClone(policyInput("SEND_PAYMENT_LINK"));
    if (raw.intent.action !== "SEND_PAYMENT_LINK")
      throw new Error("Expected link intent");
    raw.intent.intendedAmountSubunits = amount;
    expect(evaluateRecoveryPolicy(raw)).toMatchObject({
      status: "INVALID_INPUT",
      errorCode: "POLICY_INPUT_INVALID",
    });
  });

  it("rejects a provider-style money override before policy evaluation", () => {
    const raw = structuredClone(policyInput());
    (raw.aiScoringResult as unknown as Record<string, unknown>).amountSubunits =
      999_999;
    expect(evaluateRecoveryPolicy(raw)).toMatchObject({
      status: "INVALID_INPUT",
      errorCode: "POLICY_INPUT_INVALID",
    });
  });

  it("escalates a score-breakdown currency mismatch", () => {
    const input = policyInput();
    input.aiScoringResult = scoringResultFor("WAIT_FOR_RECOVERY", {
      currency: "USD",
    });
    const decision = expectDecision(evaluateRecoveryPolicy(input), "ESCALATED");
    expect(decision.ruleId).toBe("EXPECTED_VALUE_POSITIVE");
  });

  it("preserves the injected decision timestamp", () => {
    const decision = expectDecision(
      evaluateRecoveryPolicy(policyInput()),
      "APPROVED",
    );
    expect(decision.decidedAt).toBe(policyEvaluationTime);
  });
});
