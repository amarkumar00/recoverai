import { describe, expect, it } from "vitest";

import { DEFAULT_POLICY_CONFIG, policyConfigSchema } from "@/policy/config";
import {
  policyFirewallResultSchema,
  recoveryActionIntentSchema,
} from "@/policy/contracts";
import { evaluateRecoveryPolicy } from "@/policy/firewall";
import { policyInput } from "@/policy/__tests__/fixtures";
import { policyDecisionSchema } from "@/domain/policy";

describe("policy configuration and strict contracts", () => {
  it("validates the canonical policy defaults", () => {
    expect(policyConfigSchema.parse(DEFAULT_POLICY_CONFIG)).toEqual({
      maxPaymentLinksPerOrder: 1,
      maxCustomerContacts: 2,
      maxRecoveryWindowMilliseconds: 86_400_000,
      minAiConfidenceMillionths: 700_000,
    });
  });

  it.each([
    ["negative link limit", { maxPaymentLinksPerOrder: -1 }],
    ["fractional contact limit", { maxCustomerContacts: 1.5 }],
    ["zero recovery window", { maxRecoveryWindowMilliseconds: 0 }],
    ["unsafe recovery window", { maxRecoveryWindowMilliseconds: Infinity }],
    ["negative confidence", { minAiConfidenceMillionths: -1 }],
    ["excess confidence", { minAiConfidenceMillionths: 1_000_001 }],
  ])("rejects %s", (_label, override) => {
    expect(
      policyConfigSchema.safeParse({ ...DEFAULT_POLICY_CONFIG, ...override })
        .success,
    ).toBe(false);
  });

  it.each([
    ["API route", { apiRoute: "/v1/payment_links" }],
    ["recipient", { recipient: "person@example.com" }],
    ["credential", { credential: "not-allowed" }],
    ["tool instruction", { toolInstruction: "create link" }],
    ["idempotency key", { idempotencyKey: "ai-key" }],
    ["refund instruction", { refund: true }],
    ["capture instruction", { capture: true }],
  ])("rejects an intent containing %s", (_label, extra) => {
    expect(
      recoveryActionIntentSchema.safeParse({
        action: "SEND_PAYMENT_LINK",
        orderId: "order_policy_001",
        intendedAmountSubunits: 100_000,
        intendedCurrency: "INR",
        linkUse: { mode: "CREATE_NEW" },
        ...extra,
      }).success,
    ).toBe(false);
  });

  it("returns typed invalid input for an unknown raw action", () => {
    const raw = structuredClone(policyInput());
    (raw.intent as unknown as Record<string, unknown>).action =
      "REFUND_PAYMENT";
    expect(evaluateRecoveryPolicy(raw)).toEqual({
      status: "INVALID_INPUT",
      errorCode: "UNKNOWN_ACTION",
      explanation:
        "The proposed action is outside the canonical recovery allowlist.",
      issuePaths: ["intent.action"],
    });
  });

  it("returns sanitized issue paths for malformed input", () => {
    const raw = structuredClone(policyInput());
    (raw as unknown as Record<string, unknown>).paymentContext = null;
    const result = evaluateRecoveryPolicy(raw);
    expect(result).toMatchObject({
      status: "INVALID_INPUT",
      errorCode: "POLICY_INPUT_INVALID",
    });
    if (result.status !== "INVALID_INPUT")
      throw new Error("Expected invalid input");
    expect(result.issuePaths).toEqual(["paymentContext"]);
    expect(JSON.stringify(result)).not.toContain("ZodError");
  });

  it("rejects policy results with arbitrary fields", () => {
    const result = evaluateRecoveryPolicy(policyInput());
    expect(
      policyFirewallResultSchema.safeParse({ ...result, apiRoute: "/unsafe" })
        .success,
    ).toBe(false);
  });

  it.each([
    [
      "APPROVED without matching final action",
      { outcome: "APPROVED", finalAction: "SEND_PAYMENT_LINK" },
    ],
    [
      "BLOCKED with final action",
      { outcome: "BLOCKED", finalAction: "WAIT_FOR_RECOVERY" },
    ],
    [
      "ESCALATED without human action",
      { outcome: "ESCALATED", finalAction: "STOP_NON_RETRYABLE" },
    ],
    [
      "STOPPED with proactive action",
      { outcome: "STOPPED", finalAction: "WAIT_FOR_RECOVERY" },
    ],
  ])("rejects %s", (_label, override) => {
    const base = evaluateRecoveryPolicy(policyInput());
    if (base.status !== "DECIDED") throw new Error("Expected decision");
    expect(
      policyDecisionSchema.safeParse({ ...base.decision, ...override }).success,
    ).toBe(false);
  });

  it("requires the primary rule to appear exactly once in checks", () => {
    const result = evaluateRecoveryPolicy(policyInput());
    if (result.status !== "DECIDED") throw new Error("Expected decision");
    expect(
      policyDecisionSchema.safeParse({
        ...result.decision,
        ruleId: "UNLISTED_PRIMARY_RULE",
      }).success,
    ).toBe(false);
  });
});
