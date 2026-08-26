import { describe, expect, it } from "vitest";

import { generateHeldOutSelectionBatch } from "@/digital-twin/generator";
import { recoveryLinkIdSchema } from "@/domain/primitives";
import { selectCanonicalBaselineAction } from "@/evaluation/baseline";
import { BASELINE_WAIT_MILLISECONDS } from "@/evaluation/contracts";

function eligibleInput() {
  const visibleCase = generateHeldOutSelectionBatch().cases.find(
    ({ paymentSatisfaction, paymentContext }) =>
      paymentSatisfaction.status === "UNSATISFIED" &&
      !paymentContext.activeRecoveryLink.exists,
  );
  if (visibleCase === undefined) throw new Error("Eligible fixture missing.");
  const context = visibleCase.paymentContext;
  return {
    caseId: visibleCase.caseId,
    paymentId: context.paymentId,
    orderId: context.orderId,
    money: context.money,
    failureObservedAt: context.eventCreatedAt,
    decisionAt: new Date(
      Date.parse(context.eventCreatedAt) + BASELINE_WAIT_MILLISECONDS,
    ).toISOString(),
    paymentSatisfaction: visibleCase.paymentSatisfaction,
    currentReconciledState: context.currentReconciledState,
    activeRecoveryLink: context.activeRecoveryLink,
  } as const;
}

describe("canonical generic recovery baseline", () => {
  it("waits exactly 15 deterministic minutes", () => {
    const input = eligibleInput();
    expect(selectCanonicalBaselineAction(input).decisionAt).toBe(
      input.decisionAt,
    );
    expect(() =>
      selectCanonicalBaselineAction({
        ...input,
        decisionAt: new Date(Date.parse(input.decisionAt) - 1).toISOString(),
      }),
    ).toThrow(/exactly 15 minutes/);
  });

  it("creates the same generic link for an eligible verified-unpaid failure", () => {
    expect(selectCanonicalBaselineAction(eligibleInput())).toMatchObject({
      selectedAction: "SEND_PAYMENT_LINK",
      createsPaymentLink: true,
      customerContactCount: 1,
      disposition: "GENERIC_LINK_CREATED",
    });
  });

  it("reuses an existing generic link without creating a duplicate", () => {
    const input = eligibleInput();
    expect(
      selectCanonicalBaselineAction({
        ...input,
        activeRecoveryLink: {
          exists: true,
          recoveryLinkId: recoveryLinkIdSchema.parse(
            "plink_baseline_existing_001",
          ),
        },
      }),
    ).toMatchObject({
      selectedAction: "SEND_PAYMENT_LINK",
      createsPaymentLink: false,
      customerContactCount: 1,
      disposition: "GENERIC_EXISTING_LINK_REUSED",
    });
  });

  it("skips already-paid state with no link creation or contact", () => {
    const input = eligibleInput();
    expect(
      selectCanonicalBaselineAction({
        ...input,
        paymentSatisfaction: {
          status: "SATISFIED",
          basis: "PAYMENT_CAPTURED",
          verifiedAt: input.decisionAt,
        },
        currentReconciledState: {
          availability: "AVAILABLE",
          status: "CAPTURED",
          fetchedAt: input.decisionAt,
        },
      }),
    ).toMatchObject({
      selectedAction: "STOP_NON_RETRYABLE",
      createsPaymentLink: false,
      customerContactCount: 0,
      disposition: "NO_INTERVENTION_ALREADY_PAID",
    });
  });

  it.each(["UNAVAILABLE", "CONFLICTING"] as const)(
    "fails safely when payment state is %s",
    (status) => {
      const input = eligibleInput();
      const paymentSatisfaction =
        status === "UNAVAILABLE"
          ? {
              status,
              reason: "Synthetic dependency unavailable.",
              checkedAt: input.decisionAt,
            }
          : {
              status,
              reason: "Synthetic trusted observations conflict.",
              checkedAt: input.decisionAt,
            };
      expect(
        selectCanonicalBaselineAction({ ...input, paymentSatisfaction }),
      ).toMatchObject({
        selectedAction: "ESCALATE_HUMAN",
        createsPaymentLink: false,
        customerContactCount: 0,
        disposition: "ESCALATED_UNAVAILABLE_OR_CONFLICTING",
      });
    },
  );

  it("accepts only its strict safety-state input and cannot inspect diagnosis or hidden outcomes", () => {
    expect(() =>
      selectCanonicalBaselineAction({
        ...eligibleInput(),
        diagnosis: { failureClass: "CUSTOMER_CORRECTABLE" },
      } as never),
    ).toThrow();
    expect(() =>
      selectCanonicalBaselineAction({
        ...eligibleInput(),
        hiddenOutcome: { recovered: true },
      } as never),
    ).toThrow();
  });
});
