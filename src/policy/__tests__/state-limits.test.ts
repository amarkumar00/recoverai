import { describe, expect, it } from "vitest";

import type { PolicyFirewallResult } from "@/policy/contracts";
import { orderIdSchema } from "@/domain/primitives";
import { evaluateRecoveryPolicy } from "@/policy/firewall";
import {
  paymentLink,
  policyInput,
  policyWindowEnd,
} from "@/policy/__tests__/fixtures";

function decided(result: PolicyFirewallResult) {
  expect(result.status).toBe("DECIDED");
  if (result.status !== "DECIDED") throw new Error("Expected decision");
  return result.decision;
}

function makeSatisfied(
  input: ReturnType<typeof policyInput>,
  basis: "PAYMENT_AUTHORIZED" | "PAYMENT_CAPTURED" | "ORDER_PAID",
) {
  input.paymentSatisfaction = {
    status: "SATISFIED",
    basis,
    verifiedAt: input.evaluatedAt,
  };
  if (basis !== "ORDER_PAID") {
    const status = basis === "PAYMENT_AUTHORIZED" ? "AUTHORIZED" : "CAPTURED";
    input.paymentContext.currentReconciledState = {
      availability: "AVAILABLE",
      status,
      fetchedAt: input.evaluatedAt,
    };
    input.paymentContext.status = status;
  }
}

function attachBlockingLink(
  input: ReturnType<typeof policyInput>,
  status: "CREATED" | "PARTIALLY_PAID" = "CREATED",
) {
  const link = paymentLink(status);
  input.paymentLinks = [link];
  input.totalPaymentLinksCreated = 1;
  input.paymentContext.activeRecoveryLink = {
    exists: true,
    recoveryLinkId: link.recoveryLinkId,
  };
  return link;
}

describe("payment-state stopping rules", () => {
  it.each([
    ["authorized", "PAYMENT_AUTHORIZED"],
    ["captured", "PAYMENT_CAPTURED"],
    ["order paid", "ORDER_PAID"],
  ] as const)(
    "stops recovery when the original payment is %s",
    (_label, basis) => {
      const input = policyInput("SEND_PAYMENT_LINK");
      makeSatisfied(input, basis);
      const decision = decided(evaluateRecoveryPolicy(input));
      expect(decision).toMatchObject({
        outcome: "STOPPED",
        finalAction: "STOP_NON_RETRYABLE",
        ruleId: "ORIGINAL_PAYMENT_SATISFIED",
      });
    },
  );

  it("selects bounded cancellation for an eligible unpaid link after original success", () => {
    const input = policyInput("SEND_PAYMENT_LINK");
    attachBlockingLink(input);
    makeSatisfied(input, "PAYMENT_CAPTURED");
    const decision = decided(evaluateRecoveryPolicy(input));
    expect(decision).toMatchObject({
      outcome: "STOPPED",
      finalAction: "CANCEL_RECOVERY_ALREADY_PAID",
    });
  });

  it("stops outreach even when no recovery link exists", () => {
    const input = policyInput("SEND_PAYMENT_LINK");
    makeSatisfied(input, "ORDER_PAID");
    expect(decided(evaluateRecoveryPolicy(input)).finalAction).toBe(
      "STOP_NON_RETRYABLE",
    );
  });

  it("escalates a partially paid recovery link", () => {
    const input = policyInput("SEND_PAYMENT_LINK");
    attachBlockingLink(input, "PARTIALLY_PAID");
    const decision = decided(evaluateRecoveryPolicy(input));
    expect(decision).toMatchObject({
      outcome: "ESCALATED",
      finalAction: "ESCALATE_HUMAN",
      ruleId: "PAYMENT_STATE_CONFLICT",
    });
  });

  it("escalates when both original payment and recovery link appear paid", () => {
    const input = policyInput("SEND_PAYMENT_LINK");
    input.paymentLinks = [paymentLink("PAID")];
    input.totalPaymentLinksCreated = 1;
    makeSatisfied(input, "PAYMENT_CAPTURED");
    expect(decided(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "ESCALATED",
      ruleId: "PAYMENT_STATE_CONFLICT",
    });
  });

  it.each(["CANCELLED", "EXPIRED"] as const)(
    "does not repeatedly cancel an already %s link",
    (status) => {
      const input = policyInput("SEND_PAYMENT_LINK");
      input.paymentLinks = [paymentLink(status)];
      input.totalPaymentLinksCreated = 1;
      makeSatisfied(input, "ORDER_PAID");
      expect(decided(evaluateRecoveryPolicy(input))).toMatchObject({
        outcome: "STOPPED",
        finalAction: "STOP_NON_RETRYABLE",
      });
    },
  );

  it("stops after a recovery link is already paid", () => {
    const input = policyInput("WAIT_FOR_RECOVERY");
    input.paymentLinks = [paymentLink("PAID")];
    input.totalPaymentLinksCreated = 1;
    expect(decided(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "STOPPED",
      finalAction: "STOP_NON_RETRYABLE",
    });
  });

  it("escalates unavailable current payment state", () => {
    const input = policyInput();
    input.paymentSatisfaction = {
      status: "UNAVAILABLE",
      reason: "The synthetic payment lookup is unavailable.",
      checkedAt: input.evaluatedAt,
    };
    input.paymentContext.currentReconciledState = {
      availability: "UNAVAILABLE",
      reason: "The synthetic payment lookup is unavailable.",
      checkedAt: input.evaluatedAt,
    };
    expect(decided(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "ESCALATED",
      ruleId: "SAFETY_DEPENDENCY_AVAILABLE",
    });
  });

  it("escalates conflicting payment state", () => {
    const input = policyInput();
    input.paymentSatisfaction = {
      status: "CONFLICTING",
      reason: "Trusted synthetic observations conflict.",
      checkedAt: input.evaluatedAt,
    };
    expect(decided(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "ESCALATED",
      ruleId: "PAYMENT_STATE_CONFLICT",
    });
  });

  it("escalates rather than guessing when downtime context is unavailable", () => {
    const input = policyInput("WAIT_FOR_RECOVERY");
    input.paymentContext.downtimeContext = {
      availability: "UNAVAILABLE",
      reason: "Synthetic downtime dependency unavailable.",
      checkedAt: input.evaluatedAt,
    };
    expect(decided(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "ESCALATED",
      ruleId: "SAFETY_DEPENDENCY_AVAILABLE",
    });
  });
});

describe("Payment Link, contact, and recovery-window limits", () => {
  it("prevents a second link when a blocking link exists", () => {
    const input = policyInput("SEND_PAYMENT_LINK");
    attachBlockingLink(input);
    expect(decided(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "ESCALATED",
      ruleId: "PAYMENT_LINK_LIMIT",
    });
  });

  it("prevents another new link when total link count is one", () => {
    const input = policyInput("SEND_PAYMENT_LINK");
    input.totalPaymentLinksCreated = 1;
    expect(decided(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "ESCALATED",
      ruleId: "PAYMENT_LINK_LIMIT",
    });
  });

  it.each(["CANCELLED", "EXPIRED", "FAILED_SAFE"] as const)(
    "counts a historical %s link against the total-link limit",
    (status) => {
      const input = policyInput("SEND_PAYMENT_LINK");
      input.paymentLinks = [paymentLink(status)];
      input.totalPaymentLinksCreated = 1;
      expect(decided(evaluateRecoveryPolicy(input))).toMatchObject({
        outcome: "ESCALATED",
        ruleId: "PAYMENT_LINK_LIMIT",
      });
    },
  );

  it("explicitly permits reuse of the eligible existing link", () => {
    const input = policyInput("SEND_PAYMENT_LINK");
    const link = attachBlockingLink(input);
    if (input.intent.action !== "SEND_PAYMENT_LINK")
      throw new Error("Expected link intent");
    input.intent.linkUse = {
      mode: "USE_EXISTING",
      recoveryLinkId: link.recoveryLinkId,
    };
    expect(decided(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "APPROVED",
      finalAction: "SEND_PAYMENT_LINK",
    });
  });

  it("fails closed when a link belongs to another order", () => {
    const input = policyInput("SEND_PAYMENT_LINK");
    const link = paymentLink("CREATED");
    input.paymentLinks = [
      { ...link, orderId: orderIdSchema.parse("order_other_001") },
    ];
    input.totalPaymentLinksCreated = 1;
    input.paymentContext.activeRecoveryLink = {
      exists: true,
      recoveryLinkId: link.recoveryLinkId,
    };
    expect(decided(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "BLOCKED",
      ruleId: "INPUT_IDENTITY_INTEGRITY",
    });
  });

  it("permits a contact action below the limit", () => {
    const input = policyInput("REQUEST_METHOD_CHANGE");
    input.caseRecord.contactCount = 1;
    input.paymentContext.previousContactCount = 1;
    expect(decided(evaluateRecoveryPolicy(input)).outcome).toBe("APPROVED");
  });

  it.each(["SEND_PAYMENT_LINK", "REQUEST_METHOD_CHANGE"] as const)(
    "blocks another %s contact at exactly two previous contacts",
    (action) => {
      const input = policyInput(action);
      input.caseRecord.contactCount = 2;
      input.paymentContext.previousContactCount = 2;
      expect(decided(evaluateRecoveryPolicy(input))).toMatchObject({
        outcome: "ESCALATED",
        ruleId: "CUSTOMER_CONTACT_LIMIT",
      });
    },
  );

  it("does not treat waiting as customer contact", () => {
    const input = policyInput("WAIT_FOR_RECOVERY");
    input.caseRecord.contactCount = 2;
    input.paymentContext.previousContactCount = 2;
    expect(decided(evaluateRecoveryPolicy(input)).outcome).toBe("APPROVED");
  });

  it.each([
    "WAIT_FOR_RECOVERY",
    "SEND_PAYMENT_LINK",
    "REQUEST_METHOD_CHANGE",
  ] as const)("stops expired proactive action %s", (action) => {
    const input = policyInput(action);
    input.evaluatedAt = "2026-08-26T00:00:00.001Z";
    expect(decided(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "STOPPED",
      finalAction: "STOP_NON_RETRYABLE",
      ruleId: "RECOVERY_WINDOW_LIMIT",
    });
  });

  it("keeps cancellation available after window expiry", () => {
    const input = policyInput("CANCEL_RECOVERY_ALREADY_PAID");
    const link = attachBlockingLink(input);
    input.intent = {
      action: "CANCEL_RECOVERY_ALREADY_PAID",
      recoveryLinkId: link.recoveryLinkId,
    };
    input.evaluatedAt = "2026-08-26T00:00:00.001Z";
    expect(decided(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "STOPPED",
      finalAction: "CANCEL_RECOVERY_ALREADY_PAID",
    });
  });

  it("keeps human escalation available after window expiry", () => {
    const input = policyInput("ESCALATE_HUMAN");
    input.evaluatedAt = "2026-08-26T00:00:00.001Z";
    expect(decided(evaluateRecoveryPolicy(input))).toMatchObject({
      outcome: "ESCALATED",
      finalAction: "ESCALATE_HUMAN",
    });
  });

  it("uses the earlier stored window end when it is more restrictive", () => {
    const input = policyInput();
    input.caseRecord.recoveryWindowEndsAt = "2026-08-25T10:00:00.000Z";
    expect(input.evaluatedAt).toBe("2026-08-25T12:00:00.000Z");
    expect(decided(evaluateRecoveryPolicy(input)).ruleId).toBe(
      "RECOVERY_WINDOW_LIMIT",
    );
  });

  it("confirms the canonical window end used by fixtures", () => {
    expect(policyWindowEnd).toBe("2026-08-26T00:00:00.000Z");
  });
});
