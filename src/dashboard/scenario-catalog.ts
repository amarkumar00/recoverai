import {
  dashboardScenarioResultSchema,
  type DashboardScenarioKey,
  type DashboardScenarioResult,
} from "@/dashboard/contracts";

const BASE_TIME = "2026-08-26T09:00:00.000Z";

export const SCENARIO_CATALOG = Object.freeze([
  {
    scenarioKey: "DUPLICATE_DELIVERY",
    title: "Duplicate webhook delivery",
    description:
      "Replay one signature-verified Razorpay-style event ID and prove downstream effects remain exactly-once.",
  },
  {
    scenarioKey: "OUT_OF_ORDER",
    title: "Out-of-order payment events",
    description:
      "Deliver captured before authorized and prove fetched current state cannot regress.",
  },
  {
    scenarioKey: "LATE_SUCCESS",
    title: "Late original-payment success",
    description:
      "Reconcile a late authorization, stop recovery, and cancel one eligible unpaid mock link once.",
  },
  {
    scenarioKey: "INVALID_AI_AMOUNT",
    title: "Invalid AI-proposed 10× amount",
    description:
      "Run the locked adversarial amount fixture through the deterministic money-integrity boundary.",
  },
  {
    scenarioKey: "AI_TIMEOUT",
    title: "AI timeout",
    description:
      "Abort one deterministic scorer timeout with no retry and fall back to human escalation.",
  },
  {
    scenarioKey: "DOWNTIME_FAILURE",
    title: "Downtime dependency unavailable",
    description:
      "Remove downtime context, infer nothing, and take the conservative escalation path.",
  },
] as const);

function event(input: {
  delivery: number;
  type: string;
  reference: string;
  at: string;
  signature?: "VERIFIED" | "NOT_CHECKED";
  deliveryStatus:
    "ORIGINAL" | "DUPLICATE_IGNORED" | "OUT_OF_ORDER" | "STALE_IGNORED";
  snapshot: "CREATED" | "AUTHORIZED" | "CAPTURED" | "FAILED" | "UNKNOWN" | null;
  current: "CREATED" | "AUTHORIZED" | "CAPTURED" | "FAILED" | "UNKNOWN" | null;
  diagnosis?:
    | "DOWNTIME_OR_TRANSIENT"
    | "INSUFFICIENT_FUNDS"
    | "CUSTOMER_CORRECTABLE"
    | "NETWORK_OR_INTEGRATION_UNCERTAINTY"
    | "LATE_SUCCESS"
    | "NON_RETRYABLE"
    | "AMBIGUOUS"
    | null;
  proposed?:
    | "WAIT_FOR_RECOVERY"
    | "SEND_PAYMENT_LINK"
    | "REQUEST_METHOD_CHANGE"
    | "CANCEL_RECOVERY_ALREADY_PAID"
    | "STOP_NON_RETRYABLE"
    | "ESCALATE_HUMAN"
    | null;
  outcome?: "APPROVED" | "BLOCKED" | "ESCALATED" | "STOPPED" | null;
  final?:
    | "WAIT_FOR_RECOVERY"
    | "SEND_PAYMENT_LINK"
    | "REQUEST_METHOD_CHANGE"
    | "CANCEL_RECOVERY_ALREADY_PAID"
    | "STOP_NON_RETRYABLE"
    | "ESCALATE_HUMAN"
    | null;
  caseState?:
    | "DETECTED"
    | "VERIFYING"
    | "DIAGNOSED"
    | "AWAITING_POLICY"
    | "WAITING"
    | "LINK_CREATED"
    | "RECOVERED"
    | "STOPPED"
    | "ESCALATED"
    | "ERROR_SAFE"
    | null;
}) {
  return {
    delivery: input.delivery,
    eventType: input.type,
    safeReference: input.reference,
    deliveredAt: input.at,
    signatureStatus: input.signature ?? "NOT_CHECKED",
    deliveryStatus: input.deliveryStatus,
    webhookSnapshotState: input.snapshot,
    authoritativeCurrentState: input.current,
    diagnosis: input.diagnosis ?? null,
    proposedAction: input.proposed ?? null,
    policyOutcome: input.outcome ?? null,
    finalAction: input.final ?? null,
    resultingCaseState: input.caseState ?? null,
  } as const;
}

const commonMoneyChecks = [
  {
    ruleId: "INPUT_IDENTITY_INTEGRITY",
    status: "PASSED" as const,
    reason: "Case, payment, order, and fixed scenario references agree.",
  },
  {
    ruleId: "INTENT_MONEY_INTEGRITY",
    status: "PASSED" as const,
    reason:
      "The proposed amount and currency match verified server-owned values.",
  },
];

function resultFor(key: DashboardScenarioKey): DashboardScenarioResult {
  switch (key) {
    case "DUPLICATE_DELIVERY":
      return dashboardScenarioResultSchema.parse({
        scenarioKey: key,
        title: "Duplicate webhook delivery",
        completedAt: BASE_TIME,
        summary:
          "The second signature-verified delivery reused the provider event ID and was ignored before any repeated simulated recovery effect.",
        resultCode: "DUPLICATE_EVENT_IGNORED",
        policyOutcome: null,
        primaryRule: null,
        proposedAction: null,
        finalAction: null,
        finalCaseState: "DETECTED",
        authoritativePaymentState: "FAILED",
        counters: {
          acceptedDeliveries: 1,
          duplicatesIgnored: 1,
          caseTransitions: 1,
          customerContacts: 0,
          paymentLinksCreated: 0,
          paymentLinksCancelled: 0,
          automaticRetries: 0,
          simulatedRevenueRecoveredSubunits: 0,
        },
        evidence: [
          "Signature verification used the exact raw synthetic request bytes before parsing.",
          "The provider event ID was the durable deduplication key.",
          "The duplicate produced no second case transition, contact, mock link, or simulated revenue.",
        ],
        policyChecks: [
          {
            ruleId: "PROVIDER_EVENT_ID_DEDUPLICATION",
            status: "PASSED",
            reason:
              "The replay matched the first accepted event and was ignored.",
          },
        ],
        events: [
          event({
            delivery: 1,
            type: "payment.failed",
            reference: "evt_demo_verified_duplicate_v1",
            at: "2026-08-26T09:00:00.000Z",
            signature: "VERIFIED",
            deliveryStatus: "ORIGINAL",
            snapshot: "FAILED",
            current: "FAILED",
            caseState: "DETECTED",
          }),
          event({
            delivery: 2,
            type: "payment.failed",
            reference: "evt_demo_verified_duplicate_v1",
            at: "2026-08-26T09:00:01.000Z",
            signature: "VERIFIED",
            deliveryStatus: "DUPLICATE_IGNORED",
            snapshot: "FAILED",
            current: "FAILED",
            caseState: "DETECTED",
          }),
        ],
        auditEvidence: [
          {
            eventType: "WEBHOOK_EVENT_ACCEPTED",
            actor: "WEBHOOK_INGESTOR",
            reason: "First signature-verified synthetic delivery accepted.",
          },
          {
            eventType: "DUPLICATE_EVENT_IGNORED",
            actor: "WEBHOOK_INGESTOR",
            reason:
              "Repeated provider event ID caused no material downstream effect.",
          },
        ],
      });
    case "OUT_OF_ORDER":
      return dashboardScenarioResultSchema.parse({
        scenarioKey: key,
        title: "Out-of-order payment events",
        completedAt: "2026-08-26T09:05:00.000Z",
        summary:
          "Captured arrived before authorized; both deliveries reconciled to captured, so payment authority stayed monotonic and recovery stayed stopped.",
        resultCode: "AUTHORITATIVE_STATE_PRESERVED",
        policyOutcome: "STOPPED",
        primaryRule: "ORIGINAL_PAYMENT_SATISFIED",
        proposedAction: "CANCEL_RECOVERY_ALREADY_PAID",
        finalAction: "CANCEL_RECOVERY_ALREADY_PAID",
        finalCaseState: "STOPPED",
        authoritativePaymentState: "CAPTURED",
        counters: {
          acceptedDeliveries: 2,
          duplicatesIgnored: 0,
          caseTransitions: 1,
          customerContacts: 0,
          paymentLinksCreated: 0,
          paymentLinksCancelled: 1,
          automaticRetries: 0,
          simulatedRevenueRecoveredSubunits: 0,
        },
        evidence: [
          "Webhook snapshot order is retained as captured then authorized.",
          "A provider fetch returned captured for both deliveries.",
          "The later stale authorized snapshot could not regress captured authority or repeat cancellation.",
        ],
        policyChecks: [
          ...commonMoneyChecks,
          {
            ruleId: "CURRENT_PAYMENT_STATE_RECHECK",
            status: "PASSED",
            reason:
              "Authoritative fetched state was captured before any stopping action.",
          },
          {
            ruleId: "ORIGINAL_PAYMENT_SATISFIED",
            status: "PASSED",
            reason: "Verified captured state stopped proactive recovery.",
          },
        ],
        events: [
          event({
            delivery: 1,
            type: "payment.captured",
            reference: "evt_demo_ooo_captured_v1",
            at: "2026-08-26T09:04:00.000Z",
            signature: "VERIFIED",
            deliveryStatus: "OUT_OF_ORDER",
            snapshot: "CAPTURED",
            current: "CAPTURED",
            diagnosis: "LATE_SUCCESS",
            proposed: "CANCEL_RECOVERY_ALREADY_PAID",
            outcome: "STOPPED",
            final: "CANCEL_RECOVERY_ALREADY_PAID",
            caseState: "STOPPED",
          }),
          event({
            delivery: 2,
            type: "payment.authorized",
            reference: "evt_demo_ooo_authorized_v1",
            at: "2026-08-26T09:05:00.000Z",
            signature: "VERIFIED",
            deliveryStatus: "STALE_IGNORED",
            snapshot: "AUTHORIZED",
            current: "CAPTURED",
            diagnosis: "LATE_SUCCESS",
            proposed: "CANCEL_RECOVERY_ALREADY_PAID",
            outcome: "STOPPED",
            final: "CANCEL_RECOVERY_ALREADY_PAID",
            caseState: "STOPPED",
          }),
        ],
        auditEvidence: [
          {
            eventType: "PAYMENT_STATE_RECONCILED",
            actor: "STATE_RECONCILER",
            reason: "Fetched captured state became authoritative.",
          },
          {
            eventType: "RECONCILIATION_REPLAYED",
            actor: "STATE_RECONCILER",
            reason:
              "Stale authorized evidence could not regress or repeat recovery effects.",
          },
        ],
      });
    case "LATE_SUCCESS":
      return dashboardScenarioResultSchema.parse({
        scenarioKey: key,
        title: "Late original-payment success",
        completedAt: "2026-08-26T09:10:00.000Z",
        summary:
          "A verified late authorization stopped recovery and cancelled exactly one eligible unpaid simulated link; terminal or partially paid links remained protected.",
        resultCode: "RECOVERY_STOPPED_LINK_CANCELLED",
        policyOutcome: "STOPPED",
        primaryRule: "ORIGINAL_PAYMENT_SATISFIED",
        proposedAction: "CANCEL_RECOVERY_ALREADY_PAID",
        finalAction: "CANCEL_RECOVERY_ALREADY_PAID",
        finalCaseState: "STOPPED",
        authoritativePaymentState: "AUTHORIZED",
        counters: {
          acceptedDeliveries: 1,
          duplicatesIgnored: 0,
          caseTransitions: 1,
          customerContacts: 0,
          paymentLinksCreated: 0,
          paymentLinksCancelled: 1,
          automaticRetries: 0,
          simulatedRevenueRecoveredSubunits: 0,
        },
        evidence: [
          "Current original-payment state was fetched as authorized.",
          "One eligible CREATED and unpaid simulated link was cancelled once.",
          "PAID, PARTIALLY_PAID, EXPIRED, and CANCELLED links are never cancellation targets.",
          "Recovery reached a legal terminal state with no further contacts.",
        ],
        policyChecks: [
          ...commonMoneyChecks,
          {
            ruleId: "CURRENT_PAYMENT_STATE_RECHECK",
            status: "PASSED",
            reason: "Late success was verified from current payment authority.",
          },
          {
            ruleId: "ONE_ACTIVE_LINK_PER_ORDER",
            status: "PASSED",
            reason:
              "Exactly one eligible unpaid simulated link was selected for cancellation.",
          },
        ],
        events: [
          event({
            delivery: 1,
            type: "payment.authorized",
            reference: "evt_demo_late_success_v1",
            at: "2026-08-26T09:10:00.000Z",
            signature: "VERIFIED",
            deliveryStatus: "ORIGINAL",
            snapshot: "AUTHORIZED",
            current: "AUTHORIZED",
            diagnosis: "LATE_SUCCESS",
            proposed: "CANCEL_RECOVERY_ALREADY_PAID",
            outcome: "STOPPED",
            final: "CANCEL_RECOVERY_ALREADY_PAID",
            caseState: "STOPPED",
          }),
        ],
        auditEvidence: [
          {
            eventType: "ORIGINAL_PAYMENT_SATISFIED",
            actor: "STATE_RECONCILER",
            reason: "Verified late authorization stopped proactive recovery.",
          },
          {
            eventType: "PAYMENT_LINK_CANCELLED",
            actor: "RECOVERY_EXECUTOR",
            reason:
              "One eligible unpaid simulated link was cancelled idempotently.",
          },
        ],
      });
    case "INVALID_AI_AMOUNT":
      return dashboardScenarioResultSchema.parse({
        scenarioKey: key,
        title: "Invalid AI-proposed 10× amount",
        completedAt: "2026-08-26T09:15:00.000Z",
        summary:
          "A fixed INR 5,000.00 simulated proposal conflicted with the verified INR 500.00 simulated amount and was escalated before execution.",
        resultCode: "INTENT_MONEY_INTEGRITY",
        policyOutcome: "ESCALATED",
        primaryRule: "INTENT_MONEY_INTEGRITY",
        proposedAction: "SEND_PAYMENT_LINK",
        finalAction: "ESCALATE_HUMAN",
        finalCaseState: "ESCALATED",
        authoritativePaymentState: "FAILED",
        counters: {
          acceptedDeliveries: 1,
          duplicatesIgnored: 0,
          caseTransitions: 4,
          customerContacts: 0,
          paymentLinksCreated: 0,
          paymentLinksCancelled: 0,
          automaticRetries: 0,
          simulatedRevenueRecoveredSubunits: 0,
        },
        evidence: [
          "Verified server-owned simulated amount: INR 500.00.",
          "Fixed adversarial proposed simulated amount: INR 5,000.00.",
          "No executor, Payment Link, customer contact, or simulated revenue effect occurred.",
        ],
        policyChecks: [
          commonMoneyChecks[0],
          {
            ruleId: "INTENT_MONEY_INTEGRITY",
            status: "FAILED",
            reason:
              "The proposed amount was ten times the verified unpaid amount.",
          },
        ],
        events: [
          event({
            delivery: 1,
            type: "payment.failed",
            reference: "delivery_demo_failure_unsafe_v1",
            at: "2026-08-26T09:15:00.000Z",
            deliveryStatus: "ORIGINAL",
            snapshot: "FAILED",
            current: "FAILED",
            diagnosis: "CUSTOMER_CORRECTABLE",
            proposed: "SEND_PAYMENT_LINK",
            outcome: "ESCALATED",
            final: "ESCALATE_HUMAN",
            caseState: "ESCALATED",
          }),
        ],
        auditEvidence: [
          {
            eventType: "POLICY_DECISION_PERSISTED",
            actor: "POLICY_FIREWALL",
            reason: "The fixed unsafe simulated amount failed money integrity.",
          },
          {
            eventType: "UNSAFE_ACTION_BLOCKED",
            actor: "POLICY_FIREWALL",
            reason: "Escalation occurred before any financial executor call.",
          },
        ],
      });
    case "AI_TIMEOUT":
      return dashboardScenarioResultSchema.parse({
        scenarioKey: key,
        title: "AI timeout",
        completedAt: "2026-08-26T09:20:00.000Z",
        summary:
          "The deterministic scorer timed out, was aborted without retry, and returned a sanitized human-escalation fallback with no execution authority.",
        resultCode: "AI_TIMEOUT_SAFE_FALLBACK",
        policyOutcome: "ESCALATED",
        primaryRule: "AI_CONTEXT_AND_CONFIDENCE",
        proposedAction: "ESCALATE_HUMAN",
        finalAction: "ESCALATE_HUMAN",
        finalCaseState: "ESCALATED",
        authoritativePaymentState: "FAILED",
        counters: {
          acceptedDeliveries: 1,
          duplicatesIgnored: 0,
          caseTransitions: 1,
          customerContacts: 0,
          paymentLinksCreated: 0,
          paymentLinksCancelled: 0,
          automaticRetries: 0,
          simulatedRevenueRecoveredSubunits: 0,
        },
        evidence: [
          "The injected provider wait exceeded the fixed deadline and received an abort signal.",
          "No automatic scorer retry was attempted.",
          "The passive fallback selected ESCALATE_HUMAN with insufficient context and no customer message.",
        ],
        policyChecks: [
          {
            ruleId: "AI_CONTEXT_AND_CONFIDENCE",
            status: "FAILED",
            reason: "Timed-out AI context cannot authorize a financial action.",
          },
          {
            ruleId: "ALLOWLISTED_ACTION",
            status: "PASSED",
            reason:
              "The conservative fallback is one of the six allowed actions.",
          },
        ],
        events: [
          event({
            delivery: 1,
            type: "payment.failed",
            reference: "evt_demo_ai_timeout_v1",
            at: "2026-08-26T09:20:00.000Z",
            deliveryStatus: "ORIGINAL",
            snapshot: "FAILED",
            current: "FAILED",
            diagnosis: "CUSTOMER_CORRECTABLE",
            proposed: "ESCALATE_HUMAN",
            outcome: "ESCALATED",
            final: "ESCALATE_HUMAN",
            caseState: "ESCALATED",
          }),
        ],
        auditEvidence: [
          {
            eventType: "AI_SAFE_FALLBACK",
            actor: "AI_SCORER",
            reason: "The deterministic timeout produced a sanitized fallback.",
          },
          {
            eventType: "RECOVERY_ESCALATED",
            actor: "POLICY_FIREWALL",
            reason: "No action executed after scorer timeout.",
          },
        ],
      });
    case "DOWNTIME_FAILURE":
      return dashboardScenarioResultSchema.parse({
        scenarioKey: key,
        title: "Downtime dependency unavailable",
        completedAt: "2026-08-26T09:25:00.000Z",
        summary:
          "Downtime context was unavailable, so RecoverAI inferred no outage and escalated an ambiguous failure without making a recovery claim.",
        resultCode: "DOWNTIME_CONTEXT_UNAVAILABLE",
        policyOutcome: "ESCALATED",
        primaryRule: "DIAGNOSIS_ACTION_COMPATIBILITY",
        proposedAction: "ESCALATE_HUMAN",
        finalAction: "ESCALATE_HUMAN",
        finalCaseState: "ESCALATED",
        authoritativePaymentState: "FAILED",
        counters: {
          acceptedDeliveries: 1,
          duplicatesIgnored: 0,
          caseTransitions: 1,
          customerContacts: 0,
          paymentLinksCreated: 0,
          paymentLinksCancelled: 0,
          automaticRetries: 0,
          simulatedRevenueRecoveredSubunits: 0,
        },
        evidence: [
          "The deterministic mock downtime dependency returned unavailable.",
          "No active downtime was inferred from missing context.",
          "No unsupported wait/recovery claim, provider detail, or secret reached the result.",
        ],
        policyChecks: [
          {
            ruleId: "DOWNTIME_CONTEXT_REQUIRED",
            status: "FAILED",
            reason:
              "Downtime-sensitive automation requires available verified context.",
          },
          {
            ruleId: "DIAGNOSIS_ACTION_COMPATIBILITY",
            status: "PASSED",
            reason:
              "Ambiguous unavailable context permits only conservative escalation.",
          },
        ],
        events: [
          event({
            delivery: 1,
            type: "payment.failed",
            reference: "evt_demo_downtime_unavailable_v1",
            at: "2026-08-26T09:25:00.000Z",
            deliveryStatus: "ORIGINAL",
            snapshot: "FAILED",
            current: "FAILED",
            diagnosis: "AMBIGUOUS",
            proposed: "ESCALATE_HUMAN",
            outcome: "ESCALATED",
            final: "ESCALATE_HUMAN",
            caseState: "ESCALATED",
          }),
        ],
        auditEvidence: [
          {
            eventType: "DOWNTIME_CONTEXT_UNAVAILABLE",
            actor: "KNOWN_ERROR_DIAGNOSER",
            reason:
              "Missing dependency context was not converted into inferred downtime.",
          },
          {
            eventType: "RECOVERY_ESCALATED",
            actor: "POLICY_FIREWALL",
            reason: "No unsupported recovery action executed.",
          },
        ],
      });
  }
}

export function createDeterministicScenarioResult(
  key: DashboardScenarioKey,
): DashboardScenarioResult {
  return resultFor(key);
}
