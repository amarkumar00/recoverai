import type { RecoveryAction } from "@/domain/actions";
import type { FailureClass } from "@/domain/diagnosis";
import type { FailureContext } from "@/domain/payments";

// Official Razorpay references used for these exact structured identifiers:
// https://razorpay.com/docs/errors/
// https://razorpay.com/docs/errors/payments/list/
// Descriptions are deliberately excluded from matching because they are not a
// stable programmatic identifier and may contain unsafe free-form content.

export type KnownErrorRule = {
  failureClass: Exclude<FailureClass, "LATE_SUCCESS" | "AMBIGUOUS">;
  candidateActions: readonly RecoveryAction[];
  evidenceCode: string;
};

const INSUFFICIENT_FUNDS_RULE: KnownErrorRule = {
  failureClass: "INSUFFICIENT_FUNDS",
  candidateActions: [
    "REQUEST_METHOD_CHANGE",
    "SEND_PAYMENT_LINK",
    "ESCALATE_HUMAN",
  ],
  evidenceCode: "EXACT_INSUFFICIENT_FUNDS_REASON",
};

const CUSTOMER_CORRECTABLE_RULE: KnownErrorRule = {
  failureClass: "CUSTOMER_CORRECTABLE",
  candidateActions: [
    "SEND_PAYMENT_LINK",
    "REQUEST_METHOD_CHANGE",
    "ESCALATE_HUMAN",
  ],
  evidenceCode: "EXACT_CUSTOMER_CORRECTABLE_REASON",
};

const NETWORK_UNCERTAINTY_RULE: KnownErrorRule = {
  failureClass: "NETWORK_OR_INTEGRATION_UNCERTAINTY",
  candidateActions: ["WAIT_FOR_RECOVERY", "ESCALATE_HUMAN"],
  evidenceCode: "EXACT_TRANSIENT_OR_NETWORK_REASON",
};

const NON_RETRYABLE_RULE: KnownErrorRule = {
  failureClass: "NON_RETRYABLE",
  candidateActions: ["STOP_NON_RETRYABLE"],
  evidenceCode: "EXACT_NON_RETRYABLE_REASON",
};

const OFFICIAL_REASON_RULES: Readonly<Record<string, KnownErrorRule>> = {
  insufficient_funds: INSUFFICIENT_FUNDS_RULE,

  card_expired: CUSTOMER_CORRECTABLE_RULE,
  card_number_invalid: CUSTOMER_CORRECTABLE_RULE,
  incorrect_atm_pin: CUSTOMER_CORRECTABLE_RULE,
  incorrect_card_details: CUSTOMER_CORRECTABLE_RULE,
  incorrect_card_expiry_date: CUSTOMER_CORRECTABLE_RULE,
  incorrect_cvv: CUSTOMER_CORRECTABLE_RULE,
  incorrect_otp: CUSTOMER_CORRECTABLE_RULE,
  incorrect_pin: CUSTOMER_CORRECTABLE_RULE,
  invalid_otp: CUSTOMER_CORRECTABLE_RULE,
  otp_expired: CUSTOMER_CORRECTABLE_RULE,
  payment_cancelled: CUSTOMER_CORRECTABLE_RULE,

  authorisation_declined_by_psp: NETWORK_UNCERTAINTY_RULE,
  bank_cutoff_in_progress: NETWORK_UNCERTAINTY_RULE,
  bank_not_available: NETWORK_UNCERTAINTY_RULE,
  bank_technical_error: NETWORK_UNCERTAINTY_RULE,
  payment_pending: NETWORK_UNCERTAINTY_RULE,
  payment_timed_out: NETWORK_UNCERTAINTY_RULE,
  psp_app_not_available: NETWORK_UNCERTAINTY_RULE,

  capture_failed: NON_RETRYABLE_RULE,
  compliance_violation: NON_RETRYABLE_RULE,
  debit_instrument_blocked: NON_RETRYABLE_RULE,
  duplicate_request: NON_RETRYABLE_RULE,
  input_validation_failed: NON_RETRYABLE_RULE,
  international_transaction_not_allowed: NON_RETRYABLE_RULE,
  invalid_amount: NON_RETRYABLE_RULE,
  invalid_currency: NON_RETRYABLE_RULE,
  invalid_order_id: NON_RETRYABLE_RULE,
  order_amount_mismatch: NON_RETRYABLE_RULE,
  payment_method_not_enabled: NON_RETRYABLE_RULE,
  payment_risk_check_failed: NON_RETRYABLE_RULE,
};

export function findKnownErrorRule(
  failure: FailureContext | undefined,
): KnownErrorRule | null {
  const reason = failure?.errorReason;
  if (reason === undefined) {
    return null;
  }

  // Razorpay documents payment_failed as a generic gateway failure when no
  // more specific gateway code is available. Do not generalize the same text
  // from another source.
  if (reason === "payment_failed") {
    return failure?.errorSource === "gateway" ? NETWORK_UNCERTAINTY_RULE : null;
  }

  return OFFICIAL_REASON_RULES[reason] ?? null;
}

export const DOWNTIME_CANDIDATE_ACTIONS = [
  "WAIT_FOR_RECOVERY",
  "ESCALATE_HUMAN",
] as const satisfies readonly RecoveryAction[];

export const LATE_SUCCESS_CANDIDATE_ACTIONS = [
  "CANCEL_RECOVERY_ALREADY_PAID",
] as const satisfies readonly RecoveryAction[];

export const AMBIGUOUS_CANDIDATE_ACTIONS = [
  "ESCALATE_HUMAN",
] as const satisfies readonly RecoveryAction[];
