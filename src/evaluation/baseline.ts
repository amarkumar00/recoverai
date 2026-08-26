import {
  BASELINE_WAIT_MILLISECONDS,
  baselineSelectionInputSchema,
  baselineSelectionSchema,
  type BaselineSelection,
  type BaselineSelectionInput,
} from "@/evaluation/contracts";

export function selectCanonicalBaselineAction(
  rawInput: BaselineSelectionInput,
): BaselineSelection {
  const input = baselineSelectionInputSchema.parse(rawInput);
  const expectedDecisionAt =
    Date.parse(input.failureObservedAt) + BASELINE_WAIT_MILLISECONDS;
  if (Date.parse(input.decisionAt) !== expectedDecisionAt) {
    throw new Error(
      "The canonical baseline decision must occur exactly 15 minutes after the failed-payment observation.",
    );
  }

  if (input.paymentSatisfaction.status === "SATISFIED") {
    return baselineSelectionSchema.parse({
      caseId: input.caseId,
      selectedAction: "STOP_NON_RETRYABLE",
      decisionAt: input.decisionAt,
      createsPaymentLink: false,
      customerContactCount: 0,
      disposition: "NO_INTERVENTION_ALREADY_PAID",
      reasonCode: "VERIFIED_ALREADY_PAID",
    });
  }

  if (
    input.paymentSatisfaction.status === "UNAVAILABLE" ||
    input.currentReconciledState.availability === "UNAVAILABLE"
  ) {
    return baselineSelectionSchema.parse({
      caseId: input.caseId,
      selectedAction: "ESCALATE_HUMAN",
      decisionAt: input.decisionAt,
      createsPaymentLink: false,
      customerContactCount: 0,
      disposition: "ESCALATED_UNAVAILABLE_OR_CONFLICTING",
      reasonCode: "PAYMENT_STATE_UNAVAILABLE",
    });
  }

  const reconciledStatus = input.currentReconciledState.status;
  const conflicts =
    input.paymentSatisfaction.status === "CONFLICTING" ||
    (input.paymentSatisfaction.status === "UNSATISFIED" &&
      (reconciledStatus === "AUTHORIZED" ||
        reconciledStatus === "CAPTURED" ||
        reconciledStatus !== input.paymentSatisfaction.paymentStatus));
  if (conflicts) {
    return baselineSelectionSchema.parse({
      caseId: input.caseId,
      selectedAction: "ESCALATE_HUMAN",
      decisionAt: input.decisionAt,
      createsPaymentLink: false,
      customerContactCount: 0,
      disposition: "ESCALATED_UNAVAILABLE_OR_CONFLICTING",
      reasonCode: "PAYMENT_STATE_CONFLICTING",
    });
  }

  if (input.paymentSatisfaction.status !== "UNSATISFIED") {
    throw new Error("The baseline failed closed on unsupported payment state.");
  }

  return baselineSelectionSchema.parse({
    caseId: input.caseId,
    selectedAction: "SEND_PAYMENT_LINK",
    decisionAt: input.decisionAt,
    createsPaymentLink: !input.activeRecoveryLink.exists,
    customerContactCount: 1,
    disposition: input.activeRecoveryLink.exists
      ? "GENERIC_EXISTING_LINK_REUSED"
      : "GENERIC_LINK_CREATED",
    reasonCode: input.activeRecoveryLink.exists
      ? "ELIGIBLE_UNPAID_EXISTING_LINK"
      : "ELIGIBLE_UNPAID_GENERIC_LINK",
  });
}
