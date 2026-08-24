import { z } from "zod";

import {
  PROBABILITY_SCALE_MILLIONTHS,
  type ActionScoreBreakdown,
} from "@/ai/contracts";
import { RECOVERY_ACTIONS, type RecoveryAction } from "@/domain/actions";
import {
  policyDecisionSchema,
  type PolicyCheck,
  type PolicyOutcome,
} from "@/domain/policy";
import {
  policyEvaluationInputSchema,
  policyFirewallResultSchema,
  type PolicyEvaluationInput,
  type PolicyFirewallResult,
  type PolicyInvalidInputCode,
} from "@/policy/contracts";
import {
  CUSTOMER_CONTACT_ACTIONS,
  POLICY_RULE_ORDER,
  PROACTIVE_RECOVERY_ACTIONS,
  type PolicyRuleId,
} from "@/policy/rules";

const proactiveActions = new Set<RecoveryAction>(PROACTIVE_RECOVERY_ACTIONS);
const customerContactActions = new Set<RecoveryAction>(
  CUSTOMER_CONTACT_ACTIONS,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasUnknownRawIntentAction(rawInput: unknown): boolean {
  if (!isRecord(rawInput) || !isRecord(rawInput.intent)) return false;
  const action = rawInput.intent.action;
  return (
    typeof action === "string" &&
    !RECOVERY_ACTIONS.includes(action as (typeof RECOVERY_ACTIONS)[number])
  );
}

function safeIssuePath(issue: z.core.$ZodIssue): string {
  if (issue.path.length === 0) return "input";
  return issue.path
    .map((segment) =>
      typeof segment === "number" ? `[${segment}]` : String(segment),
    )
    .join(".")
    .replace(/\.\[/g, "[");
}

function invalidInput(
  errorCode: PolicyInvalidInputCode,
  issuePaths: string[],
): PolicyFirewallResult {
  return policyFirewallResultSchema.parse({
    status: "INVALID_INPUT",
    errorCode,
    explanation:
      errorCode === "UNKNOWN_ACTION"
        ? "The proposed action is outside the canonical recovery allowlist."
        : "The policy input did not satisfy the strict trusted-context contract.",
    issuePaths: [...new Set(issuePaths)].slice(0, 50),
  });
}

function isProactive(action: RecoveryAction): boolean {
  return proactiveActions.has(action);
}

function isCustomerContact(action: RecoveryAction): boolean {
  return customerContactActions.has(action);
}

function selectedBreakdowns(
  input: PolicyEvaluationInput,
): ActionScoreBreakdown[] {
  if (input.aiScoringResult.status !== "SUCCESS") return [];
  return input.aiScoringResult.scoreBreakdowns.filter(
    (breakdown) =>
      breakdown.action === input.aiScoringResult.recommendation.selectedAction,
  );
}

class DecisionChecks {
  private readonly checks = new Map<PolicyRuleId, PolicyCheck>();

  pass(ruleId: PolicyRuleId, reason: string): void {
    this.checks.set(ruleId, { ruleId, status: "PASSED", reason });
  }

  decide(
    input: PolicyEvaluationInput,
    ruleId: PolicyRuleId,
    outcome: PolicyOutcome,
    reason: string,
    finalAction?: RecoveryAction,
    status: PolicyCheck["status"] = "FAILED",
  ): PolicyFirewallResult {
    this.checks.set(ruleId, { ruleId, status, reason });
    for (const orderedRule of POLICY_RULE_ORDER) {
      if (!this.checks.has(orderedRule)) {
        this.checks.set(orderedRule, {
          ruleId: orderedRule,
          status: "NOT_APPLICABLE",
          reason:
            "A higher-precedence deterministic rule completed evaluation.",
        });
      }
    }

    const decision = policyDecisionSchema.parse({
      caseId: input.caseRecord.caseId,
      proposedAction: input.intent.action,
      ...(finalAction === undefined ? {} : { finalAction }),
      outcome,
      ruleId,
      reason,
      checksPerformed: POLICY_RULE_ORDER.map((orderedRule) =>
        this.checks.get(orderedRule)!,
      ),
      caseState: input.caseRecord.state,
      decidedAt: input.evaluatedAt,
    });

    return policyFirewallResultSchema.parse({
      status: "DECIDED",
      decision,
    });
  }
}

function identityConflict(input: PolicyEvaluationInput): string | null {
  const { caseRecord, paymentContext, diagnosis, aiScoringResult, intent } =
    input;
  const recommendation = aiScoringResult.recommendation;

  if (
    paymentContext.caseId !== caseRecord.caseId ||
    diagnosis.caseId !== caseRecord.caseId ||
    recommendation.caseId !== caseRecord.caseId
  ) {
    return "Case references do not identify the same recovery case.";
  }
  if (
    paymentContext.paymentId !== caseRecord.paymentId ||
    paymentContext.orderId !== caseRecord.orderId
  ) {
    return "Payment or order references do not match the recovery case.";
  }
  if (
    (intent.action === "SEND_PAYMENT_LINK" ||
      intent.action === "REQUEST_METHOD_CHANGE") &&
    intent.orderId !== caseRecord.orderId
  ) {
    return "The link intent order does not match the recovery case order.";
  }
  if (recommendation.selectedAction !== intent.action) {
    return "The selected recommendation action does not match the proposed intent.";
  }
  if (
    recommendation.rankedActions[0]?.action !== recommendation.selectedAction
  ) {
    return "The selected recommendation action is not ranked first.";
  }
  if (input.totalPaymentLinksCreated < input.paymentLinks.length) {
    return "The total link count is smaller than the supplied link history.";
  }
  if (
    input.paymentLinks.some(
      (link) =>
        link.caseId !== caseRecord.caseId ||
        link.orderId !== caseRecord.orderId,
    )
  ) {
    return "A Payment Link record belongs to another case or order.";
  }
  if (paymentContext.previousContactCount !== caseRecord.contactCount) {
    return "Trusted customer-contact counts do not agree.";
  }

  const blockingLinks = input.paymentLinks.filter(
    (link) => link.blocksCreation,
  );
  if (paymentContext.activeRecoveryLink.exists) {
    if (
      blockingLinks.length !== 1 ||
      blockingLinks[0]?.recoveryLinkId !==
        paymentContext.activeRecoveryLink.recoveryLinkId
    ) {
      return "Active recovery-link context does not match the blocking link record.";
    }
  } else if (blockingLinks.length !== 0) {
    return "A blocking Payment Link exists without matching active-link context.";
  }

  if (aiScoringResult.status === "SUCCESS") {
    if (selectedBreakdowns(input).length !== 1) {
      return "Exactly one score breakdown must correspond to the selected action.";
    }
  }

  if (
    caseRecord.recoveryWindowStartsAt !== undefined &&
    input.evaluatedAt < caseRecord.recoveryWindowStartsAt
  ) {
    return "The evaluation timestamp precedes the recovery-window start.";
  }

  return null;
}

function paymentStateConflict(input: PolicyEvaluationInput): string | null {
  const { caseRecord, paymentContext, paymentSatisfaction, paymentLinks } =
    input;
  if (
    paymentContext.money.amountSubunits !==
      caseRecord.verifiedUnpaidAmountSubunits ||
    paymentContext.money.currency !== caseRecord.currency
  ) {
    return "Trusted case and payment money observations conflict.";
  }
  if (
    paymentLinks.some(
      (link) =>
        link.amountSubunits !== caseRecord.verifiedUnpaidAmountSubunits ||
        link.currency !== caseRecord.currency,
    )
  ) {
    return "A Payment Link money observation conflicts with verified case money.";
  }
  if (paymentSatisfaction.status === "CONFLICTING") {
    return "Trusted payment-satisfaction observations conflict.";
  }
  if (paymentLinks.some((link) => link.status === "PARTIALLY_PAID")) {
    return "A partially paid recovery link requires human review in the MVP.";
  }
  if (
    paymentSatisfaction.status === "SATISFIED" &&
    paymentLinks.some((link) => link.status === "PAID")
  ) {
    return "Both the original payment and a recovery link appear paid.";
  }

  const reconciled = paymentContext.currentReconciledState;
  if (reconciled.availability === "AVAILABLE") {
    if (
      paymentSatisfaction.status === "UNSATISFIED" &&
      (reconciled.status === "AUTHORIZED" || reconciled.status === "CAPTURED")
    ) {
      return "Verified unpaid context conflicts with a successful current payment state.";
    }
    if (
      paymentSatisfaction.status === "UNSATISFIED" &&
      reconciled.status !== paymentSatisfaction.paymentStatus
    ) {
      return "Trusted unpaid payment statuses do not agree.";
    }
    if (
      paymentSatisfaction.status === "SATISFIED" &&
      paymentSatisfaction.basis === "PAYMENT_AUTHORIZED" &&
      reconciled.status !== "AUTHORIZED" &&
      reconciled.status !== "CAPTURED"
    ) {
      return "Authorized satisfaction conflicts with the current payment state.";
    }
    if (
      paymentSatisfaction.status === "SATISFIED" &&
      paymentSatisfaction.basis === "PAYMENT_CAPTURED" &&
      reconciled.status !== "CAPTURED"
    ) {
      return "Captured satisfaction conflicts with the current payment state.";
    }
  }

  return null;
}

function selectedScoreIntegrityConflict(
  input: PolicyEvaluationInput,
  breakdown: ActionScoreBreakdown,
): string | null {
  const recommendation = input.aiScoringResult.recommendation;
  if (breakdown.currency !== input.caseRecord.currency) {
    return "The selected score currency does not match verified case currency.";
  }
  const expectedProbabilityMillionths = Math.round(
    (recommendation.rankedActions[0]?.recoveryProbability ?? -1) *
      PROBABILITY_SCALE_MILLIONTHS,
  );
  if (
    breakdown.recoveryProbabilityMillionths !== expectedProbabilityMillionths
  ) {
    return "The selected score probability does not match the ranked recommendation.";
  }

  const expectedRecovered =
    (BigInt(input.caseRecord.verifiedUnpaidAmountSubunits) *
      BigInt(breakdown.recoveryProbabilityMillionths)) /
    BigInt(PROBABILITY_SCALE_MILLIONTHS);
  if (expectedRecovered !== BigInt(breakdown.expectedRecoveredSubunits)) {
    return "The selected expected-recovery amount is inconsistent with trusted fixed-point inputs.";
  }

  const totalPenalty =
    BigInt(breakdown.contactCostSubunits) +
    BigInt(breakdown.frictionPenaltySubunits) +
    BigInt(breakdown.duplicatePaymentRiskPenaltySubunits) +
    BigInt(breakdown.operationalCostSubunits);
  if (totalPenalty !== BigInt(breakdown.totalPenaltySubunits)) {
    return "The selected score penalty total is internally inconsistent.";
  }
  if (
    BigInt(breakdown.expectedRecoveredSubunits) - totalPenalty !==
    BigInt(breakdown.expectedValueSubunits)
  ) {
    return "The selected expected-value breakdown is internally inconsistent.";
  }
  return null;
}

function compatibleDiagnosis(input: PolicyEvaluationInput): boolean {
  const { action } = input.intent;
  const { diagnosis, paymentContext, paymentSatisfaction } = input;
  if (action === "ESCALATE_HUMAN") return true;
  if (action === "CANCEL_RECOVERY_ALREADY_PAID") {
    return paymentSatisfaction.status === "SATISFIED";
  }
  if (action === "STOP_NON_RETRYABLE") {
    return diagnosis.failureClass === "NON_RETRYABLE";
  }
  if (
    diagnosis.knowledgeStatus !== "KNOWN" ||
    !diagnosis.candidateActions.includes(action)
  ) {
    return false;
  }
  if (action === "WAIT_FOR_RECOVERY") {
    if (
      diagnosis.failureClass !== "DOWNTIME_OR_TRANSIENT" &&
      diagnosis.failureClass !== "NETWORK_OR_INTEGRATION_UNCERTAINTY"
    ) {
      return false;
    }
    if (paymentContext.downtimeContext.availability !== "AVAILABLE") {
      return false;
    }
    return (
      diagnosis.failureClass !== "DOWNTIME_OR_TRANSIENT" ||
      paymentContext.downtimeContext.active
    );
  }
  return (
    diagnosis.failureClass === "INSUFFICIENT_FUNDS" ||
    diagnosis.failureClass === "CUSTOMER_CORRECTABLE"
  );
}

function evaluateValidatedPolicy(
  input: PolicyEvaluationInput,
): PolicyFirewallResult {
  const checks = new DecisionChecks();
  const action = input.intent.action;

  const identityIssue = identityConflict(input);
  if (identityIssue !== null) {
    return checks.decide(
      input,
      "INPUT_IDENTITY_INTEGRITY",
      "BLOCKED",
      identityIssue,
    );
  }
  checks.pass(
    "INPUT_IDENTITY_INTEGRITY",
    "Case, payment, order, action, link, contact, and score references agree.",
  );

  const stateIssue = paymentStateConflict(input);
  if (stateIssue !== null) {
    return checks.decide(
      input,
      "PAYMENT_STATE_CONFLICT",
      "ESCALATED",
      stateIssue,
      "ESCALATE_HUMAN",
    );
  }
  checks.pass(
    "PAYMENT_STATE_CONFLICT",
    "No partial-payment, duplicate-payment, or trusted money conflict is present.",
  );

  const paidLinks = input.paymentLinks.filter((link) => link.status === "PAID");
  if (paidLinks.length > 0) {
    return checks.decide(
      input,
      "ORIGINAL_PAYMENT_SATISFIED",
      "STOPPED",
      "A recovery link is already paid, so further recovery must stop.",
      "STOP_NON_RETRYABLE",
    );
  }
  if (input.paymentSatisfaction.status === "SATISFIED") {
    const cancellableLinks = input.paymentLinks.filter(
      (link) => link.status === "CREATED" && link.blocksCreation,
    );
    return checks.decide(
      input,
      "ORIGINAL_PAYMENT_SATISFIED",
      "STOPPED",
      cancellableLinks.length === 1
        ? "Verified original payment success stops outreach and permits cancellation of the eligible unpaid recovery link."
        : "Verified original payment success stops outreach; no eligible unpaid recovery link should be cancelled.",
      cancellableLinks.length === 1
        ? "CANCEL_RECOVERY_ALREADY_PAID"
        : "STOP_NON_RETRYABLE",
    );
  }
  if (
    input.caseRecord.state === "RECOVERED" ||
    input.caseRecord.state === "STOPPED"
  ) {
    return checks.decide(
      input,
      "ORIGINAL_PAYMENT_SATISFIED",
      "STOPPED",
      "The current case state already prevents further proactive recovery.",
      "STOP_NON_RETRYABLE",
    );
  }
  if (
    input.caseRecord.state === "ESCALATED" ||
    input.caseRecord.state === "ERROR_SAFE"
  ) {
    return checks.decide(
      input,
      "ORIGINAL_PAYMENT_SATISFIED",
      "ESCALATED",
      "The current case state requires human review instead of proactive recovery.",
      "ESCALATE_HUMAN",
    );
  }
  checks.pass(
    "ORIGINAL_PAYMENT_SATISFIED",
    "No verified successful payment or terminal recovery state requires stopping.",
  );

  if (
    input.paymentSatisfaction.status === "UNAVAILABLE" ||
    input.paymentContext.currentReconciledState.availability === "UNAVAILABLE"
  ) {
    return checks.decide(
      input,
      "SAFETY_DEPENDENCY_AVAILABLE",
      "ESCALATED",
      "Current payment satisfaction is unavailable and cannot be assumed unpaid.",
      "ESCALATE_HUMAN",
    );
  }
  if (
    action === "WAIT_FOR_RECOVERY" &&
    input.paymentContext.downtimeContext.availability === "UNAVAILABLE"
  ) {
    return checks.decide(
      input,
      "SAFETY_DEPENDENCY_AVAILABLE",
      "ESCALATED",
      "Downtime context is unavailable and was not interpreted as active downtime.",
      "ESCALATE_HUMAN",
    );
  }
  checks.pass(
    "SAFETY_DEPENDENCY_AVAILABLE",
    "All action-critical trusted dependencies are available.",
  );

  if (action === "SEND_PAYMENT_LINK" || action === "REQUEST_METHOD_CHANGE") {
    if (
      input.intent.intendedAmountSubunits !==
        input.caseRecord.verifiedUnpaidAmountSubunits ||
      input.intent.intendedCurrency !== input.caseRecord.currency
    ) {
      return checks.decide(
        input,
        "INTENT_MONEY_INTEGRITY",
        "ESCALATED",
        "The proposed link money does not exactly match verified unpaid money.",
        "ESCALATE_HUMAN",
      );
    }
  }
  checks.pass(
    "INTENT_MONEY_INTEGRITY",
    "Any money-bearing intent exactly matches verified amount and currency.",
  );

  if (action === "SEND_PAYMENT_LINK" || action === "REQUEST_METHOD_CHANGE") {
    const linkUse = input.intent.linkUse;
    if (linkUse.mode === "CREATE_NEW") {
      if (input.paymentLinks.some((link) => link.blocksCreation)) {
        return checks.decide(
          input,
          "PAYMENT_LINK_LIMIT",
          "ESCALATED",
          "An active blocking recovery link prevents creation of another link.",
          "ESCALATE_HUMAN",
        );
      }
      if (
        input.totalPaymentLinksCreated >= input.config.maxPaymentLinksPerOrder
      ) {
        return checks.decide(
          input,
          "PAYMENT_LINK_LIMIT",
          "ESCALATED",
          "The configured total Payment Link limit for this order is reached.",
          "ESCALATE_HUMAN",
        );
      }
    } else {
      const existing = input.paymentLinks.find(
        (link) => link.recoveryLinkId === linkUse.recoveryLinkId,
      );
      if (
        existing === undefined ||
        existing.status !== "CREATED" ||
        !existing.blocksCreation
      ) {
        return checks.decide(
          input,
          "PAYMENT_LINK_LIMIT",
          "ESCALATED",
          "The requested existing recovery link is not eligible for bounded reuse.",
          "ESCALATE_HUMAN",
        );
      }
    }
  }
  checks.pass(
    "PAYMENT_LINK_LIMIT",
    "The intent respects active-link uniqueness and the configured total-link limit.",
  );

  if (
    isCustomerContact(action) &&
    input.caseRecord.contactCount >= input.config.maxCustomerContacts
  ) {
    return checks.decide(
      input,
      "CUSTOMER_CONTACT_LIMIT",
      "ESCALATED",
      "The configured customer-contact limit is already reached.",
      "ESCALATE_HUMAN",
    );
  }
  checks.pass(
    "CUSTOMER_CONTACT_LIMIT",
    isCustomerContact(action)
      ? "The customer-contact count is below the configured maximum."
      : "The proposed action is not a customer-contact action.",
  );

  if (isProactive(action)) {
    const startsAt = input.caseRecord.recoveryWindowStartsAt;
    if (startsAt === undefined) {
      return checks.decide(
        input,
        "RECOVERY_WINDOW_LIMIT",
        "ESCALATED",
        "A recovery-window start is required for proactive recovery.",
        "ESCALATE_HUMAN",
      );
    }
    const configuredEnd =
      Date.parse(startsAt) + input.config.maxRecoveryWindowMilliseconds;
    const storedEnd =
      input.caseRecord.recoveryWindowEndsAt === undefined
        ? configuredEnd
        : Date.parse(input.caseRecord.recoveryWindowEndsAt);
    const effectiveEnd = Math.min(configuredEnd, storedEnd);
    if (Date.parse(input.evaluatedAt) > effectiveEnd) {
      return checks.decide(
        input,
        "RECOVERY_WINDOW_LIMIT",
        "STOPPED",
        "The inclusive recovery window has expired, so proactive recovery stops.",
        "STOP_NON_RETRYABLE",
      );
    }
  }
  checks.pass(
    "RECOVERY_WINDOW_LIMIT",
    isProactive(action)
      ? "Evaluation is within the inclusive configured recovery window."
      : "The recovery-window limit does not restrict this safety action.",
  );

  if (isProactive(action)) {
    if (input.aiScoringResult.status !== "SUCCESS") {
      return checks.decide(
        input,
        "AI_RECOMMENDATION_BOUNDARY",
        "ESCALATED",
        "The scorer returned a safe fallback rather than an executable recommendation.",
        "ESCALATE_HUMAN",
      );
    }
    const confidenceMillionths = Math.floor(
      input.aiScoringResult.recommendation.confidence *
        PROBABILITY_SCALE_MILLIONTHS,
    );
    if (
      confidenceMillionths < input.config.minAiConfidenceMillionths ||
      input.aiScoringResult.recommendation.contextStatus !== "SUFFICIENT"
    ) {
      return checks.decide(
        input,
        "AI_RECOMMENDATION_BOUNDARY",
        "ESCALATED",
        "AI confidence or context sufficiency is below the configured boundary.",
        "ESCALATE_HUMAN",
      );
    }
    if (!input.diagnosis.candidateActions.includes(action)) {
      return checks.decide(
        input,
        "AI_RECOMMENDATION_BOUNDARY",
        "ESCALATED",
        "The selected action is outside deterministic diagnosis candidates.",
        "ESCALATE_HUMAN",
      );
    }
  }
  checks.pass(
    "AI_RECOMMENDATION_BOUNDARY",
    isProactive(action)
      ? "The successful recommendation meets confidence, context, rank, and candidate requirements."
      : "AI confidence does not prevent deterministic safety actions.",
  );

  if (isProactive(action)) {
    const breakdown = selectedBreakdowns(input)[0];
    if (breakdown === undefined) {
      return checks.decide(
        input,
        "EXPECTED_VALUE_POSITIVE",
        "BLOCKED",
        "The selected action has no trusted score breakdown.",
      );
    }
    const scoreIssue = selectedScoreIntegrityConflict(input, breakdown);
    if (scoreIssue !== null) {
      return checks.decide(
        input,
        "EXPECTED_VALUE_POSITIVE",
        "ESCALATED",
        scoreIssue,
        "ESCALATE_HUMAN",
      );
    }
    if (breakdown.expectedValueSubunits <= 0) {
      return checks.decide(
        input,
        "EXPECTED_VALUE_POSITIVE",
        "STOPPED",
        "The selected proactive action has non-positive expected economic value.",
        "STOP_NON_RETRYABLE",
      );
    }
  }
  checks.pass(
    "EXPECTED_VALUE_POSITIVE",
    isProactive(action)
      ? "The trusted selected-action expected value is positive."
      : "Expected-value gating does not prevent deterministic safety actions.",
  );

  if (!compatibleDiagnosis(input)) {
    return checks.decide(
      input,
      "DIAGNOSIS_ACTION_COMPATIBILITY",
      "ESCALATED",
      "The proposed action is incompatible with deterministic diagnosis or payment context.",
      "ESCALATE_HUMAN",
    );
  }
  if (action === "ESCALATE_HUMAN") {
    return checks.decide(
      input,
      "DIAGNOSIS_ACTION_COMPATIBILITY",
      "ESCALATED",
      "The bounded human-escalation intent is preserved without customer contact or execution.",
      "ESCALATE_HUMAN",
      "PASSED",
    );
  }
  if (action === "STOP_NON_RETRYABLE") {
    return checks.decide(
      input,
      "DIAGNOSIS_ACTION_COMPATIBILITY",
      "STOPPED",
      "The non-retryable diagnosis deterministically stops proactive recovery.",
      "STOP_NON_RETRYABLE",
      "PASSED",
    );
  }
  if (action === "CANCEL_RECOVERY_ALREADY_PAID") {
    return checks.decide(
      input,
      "DIAGNOSIS_ACTION_COMPATIBILITY",
      "STOPPED",
      "Verified satisfaction deterministically stops recovery with bounded cancellation semantics.",
      "CANCEL_RECOVERY_ALREADY_PAID",
      "PASSED",
    );
  }
  checks.pass(
    "DIAGNOSIS_ACTION_COMPATIBILITY",
    "The proposed proactive action is compatible with deterministic diagnosis and context.",
  );

  return checks.decide(
    input,
    "POLICY_APPROVED",
    "APPROVED",
    "Every deterministic policy rule passed; execution remains deferred.",
    action,
    "PASSED",
  );
}

export function evaluateRecoveryPolicy(
  rawInput: unknown,
): PolicyFirewallResult {
  const parsed = policyEvaluationInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const unknownAction = hasUnknownRawIntentAction(rawInput);
    return invalidInput(
      unknownAction ? "UNKNOWN_ACTION" : "POLICY_INPUT_INVALID",
      unknownAction
        ? ["intent.action"]
        : parsed.error.issues.map(safeIssuePath),
    );
  }
  return evaluateValidatedPolicy(parsed.data);
}
