import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { RECOVERY_ACTIONS } from "@/domain/actions";
import { SUPPORTED_WEBHOOK_EVENT_NAMES } from "@/domain/events";
import { NORMALIZED_PAYMENT_STATUSES } from "@/domain/payments";
import { RECOVERY_CASE_STATES } from "@/domain/states";

export const WEBHOOK_SIGNATURE_STATUSES = [
  "VERIFIED",
  "REJECTED",
  "NOT_CHECKED",
] as const;

export const WEBHOOK_PROCESSING_STATUSES = [
  "FIRST_SEEN",
  "DUPLICATE",
  "NOT_CHECKED",
] as const;

export const RECOVERY_ACTION_STATUSES = [
  "REQUESTED",
  "STARTED",
  "SUCCEEDED",
  "FAILED_SAFE",
  "CANCELLED",
] as const;

export const PAYMENT_LINK_STATUSES = [
  "CREATED",
  "PARTIALLY_PAID",
  "PAID",
  "CANCELLED",
  "EXPIRED",
  "FAILED_SAFE",
] as const;

export const DEMO_SCENARIO_KEYS = [
  "DUPLICATE_DELIVERY",
  "OUT_OF_ORDER",
  "LATE_SUCCESS",
  "INVALID_AI_AMOUNT",
  "AI_TIMEOUT",
  "DOWNTIME_FAILURE",
] as const;

export const webhookEvents = sqliteTable(
  "webhook_events",
  {
    id: text("id").primaryKey(),
    providerEventId: text("provider_event_id").notNull(),
    eventName: text("event_name", {
      enum: SUPPORTED_WEBHOOK_EVENT_NAMES,
    }).notNull(),
    occurredAt: text("occurred_at").notNull(),
    receivedAt: text("received_at").notNull(),
    signatureStatus: text("signature_status", {
      enum: WEBHOOK_SIGNATURE_STATUSES,
    }).notNull(),
    processingStatus: text("processing_status", {
      enum: WEBHOOK_PROCESSING_STATUSES,
    }).notNull(),
    paymentId: text("payment_id"),
    orderId: text("order_id"),
    recoveryLinkId: text("recovery_link_id"),
    normalizedEventJson: text("normalized_event_json").notNull(),
    payloadDigest: text("payload_digest"),
    createdAt: text("created_at").notNull(),
    processedAt: text("processed_at"),
    safeErrorReason: text("safe_error_reason"),
  },
  (table) => [
    uniqueIndex("webhook_events_provider_event_id_uq").on(
      table.providerEventId,
    ),
    index("webhook_events_payment_id_idx").on(table.paymentId),
    index("webhook_events_order_id_idx").on(table.orderId),
    index("webhook_events_received_at_idx").on(table.receivedAt),
    check(
      "webhook_events_signature_status_check",
      sql`${table.signatureStatus} IN ('VERIFIED','REJECTED','NOT_CHECKED')`,
    ),
    check(
      "webhook_events_event_name_check",
      sql`${table.eventName} IN ('payment.failed','payment.authorized','payment.captured','order.paid','payment.downtime.started','payment.downtime.resolved','payment.downtime.updated','payment_link.paid','payment_link.partially_paid','payment_link.cancelled','payment_link.expired')`,
    ),
    check(
      "webhook_events_processing_status_check",
      sql`${table.processingStatus} IN ('FIRST_SEEN','DUPLICATE','NOT_CHECKED')`,
    ),
    check(
      "webhook_events_payload_digest_check",
      sql`${table.payloadDigest} IS NULL OR (${table.payloadDigest} NOT GLOB '*[^0-9a-f]*' AND length(${table.payloadDigest}) = 64)`,
    ),
  ],
);

export const paymentSnapshots = sqliteTable(
  "payment_snapshots",
  {
    snapshotSequence: integer("snapshot_sequence", {
      mode: "number",
    }).primaryKey({ autoIncrement: true }),
    paymentId: text("payment_id").notNull(),
    orderId: text("order_id").notNull(),
    amountSubunits: integer("amount_subunits", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    status: text("status", { enum: NORMALIZED_PAYMENT_STATUSES }).notNull(),
    method: text("method").notNull(),
    bankOrProvider: text("bank_or_provider"),
    failureJson: text("failure_json"),
    providerCreatedAt: text("provider_created_at").notNull(),
    observedAt: text("observed_at").notNull(),
    sourceEventId: text("source_event_id").references(() => webhookEvents.id),
    createdAt: text("created_at").notNull(),
    snapshotOrigin: text("snapshot_origin", {
      enum: ["WEBHOOK_EVIDENCE", "PROVIDER_RECONCILED"],
    })
      .notNull()
      .default("WEBHOOK_EVIDENCE"),
  },
  (table) => [
    index("payment_snapshots_payment_latest_idx").on(
      table.paymentId,
      table.observedAt,
      table.snapshotSequence,
    ),
    index("payment_snapshots_order_id_idx").on(table.orderId),
    uniqueIndex("payment_snapshots_source_origin_uq").on(
      table.sourceEventId,
      table.snapshotOrigin,
    ),
    check(
      "payment_snapshots_amount_check",
      sql`typeof(${table.amountSubunits}) = 'integer' AND ${table.amountSubunits} >= 0`,
    ),
    check(
      "payment_snapshots_currency_check",
      sql`length(${table.currency}) = 3 AND ${table.currency} = upper(${table.currency})`,
    ),
    check(
      "payment_snapshots_status_check",
      sql`${table.status} IN ('CREATED','AUTHORIZED','CAPTURED','FAILED','UNKNOWN')`,
    ),
    check(
      "payment_snapshots_origin_check",
      sql`${table.snapshotOrigin} IN ('WEBHOOK_EVIDENCE','PROVIDER_RECONCILED')`,
    ),
  ],
);

export const recoveryCases = sqliteTable(
  "recovery_cases",
  {
    caseId: text("case_id").primaryKey(),
    paymentId: text("payment_id").notNull(),
    orderId: text("order_id").notNull(),
    syntheticCustomerHash: text("synthetic_customer_hash").notNull(),
    verifiedUnpaidAmountSubunits: integer("verified_unpaid_amount_subunits", {
      mode: "number",
    }).notNull(),
    currency: text("currency").notNull(),
    state: text("state", { enum: RECOVERY_CASE_STATES }).notNull(),
    attemptNumber: integer("attempt_number", { mode: "number" }).notNull(),
    previousSuccessCount: integer("previous_success_count", {
      mode: "number",
    }).notNull(),
    previousFailureCount: integer("previous_failure_count", {
      mode: "number",
    }).notNull(),
    contactCount: integer("contact_count", { mode: "number" }).notNull(),
    recoveryWindowStartsAt: text("recovery_window_starts_at"),
    recoveryWindowEndsAt: text("recovery_window_ends_at"),
    version: integer("version", { mode: "number" }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("recovery_cases_payment_id_uq").on(table.paymentId),
    index("recovery_cases_order_id_idx").on(table.orderId),
    index("recovery_cases_state_updated_idx").on(table.state, table.updatedAt),
    check(
      "recovery_cases_amount_check",
      sql`typeof(${table.verifiedUnpaidAmountSubunits}) = 'integer' AND ${table.verifiedUnpaidAmountSubunits} >= 0`,
    ),
    check(
      "recovery_cases_currency_check",
      sql`length(${table.currency}) = 3 AND ${table.currency} = upper(${table.currency})`,
    ),
    check(
      "recovery_cases_state_check",
      sql`${table.state} IN ('DETECTED','VERIFYING','DIAGNOSED','AWAITING_POLICY','WAITING','LINK_CREATED','RECOVERED','STOPPED','ESCALATED','ERROR_SAFE')`,
    ),
    check(
      "recovery_cases_attempt_check",
      sql`typeof(${table.attemptNumber}) = 'integer' AND ${table.attemptNumber} >= 1`,
    ),
    check(
      "recovery_cases_counts_check",
      sql`typeof(${table.previousSuccessCount}) = 'integer' AND ${table.previousSuccessCount} >= 0 AND typeof(${table.previousFailureCount}) = 'integer' AND ${table.previousFailureCount} >= 0 AND typeof(${table.contactCount}) = 'integer' AND ${table.contactCount} >= 0`,
    ),
    check(
      "recovery_cases_version_check",
      sql`typeof(${table.version}) = 'integer' AND ${table.version} >= 1`,
    ),
  ],
);

export const aiRecommendations = sqliteTable(
  "ai_recommendations",
  {
    recommendationId: text("recommendation_id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => recoveryCases.caseId),
    recommendationJson: text("recommendation_json").notNull(),
    selectedAction: text("selected_action", {
      enum: RECOVERY_ACTIONS,
    }).notNull(),
    confidence: integer("confidence_millionths", { mode: "number" }).notNull(),
    contextStatus: text("context_status").notNull(),
    escalationRecommended: integer("escalation_recommended", {
      mode: "boolean",
    }).notNull(),
    recommendedAt: text("recommended_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("ai_recommendations_case_recommended_idx").on(
      table.caseId,
      table.recommendedAt,
    ),
    check(
      "ai_recommendations_action_check",
      sql`${table.selectedAction} IN ('WAIT_FOR_RECOVERY','SEND_PAYMENT_LINK','REQUEST_METHOD_CHANGE','CANCEL_RECOVERY_ALREADY_PAID','STOP_NON_RETRYABLE','ESCALATE_HUMAN')`,
    ),
    check(
      "ai_recommendations_confidence_check",
      sql`typeof(${table.confidence}) = 'integer' AND ${table.confidence} BETWEEN 0 AND 1000000`,
    ),
    check(
      "ai_recommendations_context_check",
      sql`${table.contextStatus} IN ('SUFFICIENT','INSUFFICIENT')`,
    ),
    check(
      "ai_recommendations_escalation_check",
      sql`${table.escalationRecommended} IN (0,1)`,
    ),
  ],
);

export const policyDecisions = sqliteTable(
  "policy_decisions",
  {
    decisionId: text("decision_id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => recoveryCases.caseId),
    decisionJson: text("decision_json").notNull(),
    proposedAction: text("proposed_action", {
      enum: RECOVERY_ACTIONS,
    }).notNull(),
    finalAction: text("final_action", { enum: RECOVERY_ACTIONS }),
    outcome: text("outcome").notNull(),
    ruleId: text("rule_id").notNull(),
    reason: text("reason").notNull(),
    caseState: text("case_state", { enum: RECOVERY_CASE_STATES }).notNull(),
    decidedAt: text("decided_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("policy_decisions_case_decided_idx").on(
      table.caseId,
      table.decidedAt,
    ),
    check(
      "policy_decisions_proposed_action_check",
      sql`${table.proposedAction} IN ('WAIT_FOR_RECOVERY','SEND_PAYMENT_LINK','REQUEST_METHOD_CHANGE','CANCEL_RECOVERY_ALREADY_PAID','STOP_NON_RETRYABLE','ESCALATE_HUMAN')`,
    ),
    check(
      "policy_decisions_final_action_check",
      sql`${table.finalAction} IS NULL OR ${table.finalAction} IN ('WAIT_FOR_RECOVERY','SEND_PAYMENT_LINK','REQUEST_METHOD_CHANGE','CANCEL_RECOVERY_ALREADY_PAID','STOP_NON_RETRYABLE','ESCALATE_HUMAN')`,
    ),
    check(
      "policy_decisions_outcome_check",
      sql`${table.outcome} IN ('APPROVED','BLOCKED','ESCALATED','STOPPED')`,
    ),
    check(
      "policy_decisions_state_check",
      sql`${table.caseState} IN ('DETECTED','VERIFYING','DIAGNOSED','AWAITING_POLICY','WAITING','LINK_CREATED','RECOVERED','STOPPED','ESCALATED','ERROR_SAFE')`,
    ),
  ],
);

export const recoveryActions = sqliteTable(
  "recovery_actions",
  {
    actionRecordId: text("action_record_id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => recoveryCases.caseId),
    action: text("action", { enum: RECOVERY_ACTIONS }).notNull(),
    status: text("status", { enum: RECOVERY_ACTION_STATUSES }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    attemptCount: integer("attempt_count", { mode: "number" }).notNull(),
    safeResultCode: text("safe_result_code"),
    safeResultDetail: text("safe_result_detail"),
    safeErrorReason: text("safe_error_reason"),
    requestedAt: text("requested_at").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("recovery_actions_idempotency_key_uq").on(table.idempotencyKey),
    index("recovery_actions_case_requested_idx").on(
      table.caseId,
      table.requestedAt,
    ),
    check(
      "recovery_actions_action_check",
      sql`${table.action} IN ('WAIT_FOR_RECOVERY','SEND_PAYMENT_LINK','REQUEST_METHOD_CHANGE','CANCEL_RECOVERY_ALREADY_PAID','STOP_NON_RETRYABLE','ESCALATE_HUMAN')`,
    ),
    check(
      "recovery_actions_status_check",
      sql`${table.status} IN ('REQUESTED','STARTED','SUCCEEDED','FAILED_SAFE','CANCELLED')`,
    ),
    check(
      "recovery_actions_attempt_count_check",
      sql`typeof(${table.attemptCount}) = 'integer' AND ${table.attemptCount} >= 0`,
    ),
  ],
);

export const paymentLinks = sqliteTable(
  "payment_links",
  {
    recoveryLinkId: text("recovery_link_id").primaryKey(),
    externalLinkId: text("external_link_id"),
    caseId: text("case_id")
      .notNull()
      .references(() => recoveryCases.caseId),
    orderId: text("order_id").notNull(),
    referenceId: text("reference_id").notNull(),
    amountSubunits: integer("amount_subunits", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    status: text("status", { enum: PAYMENT_LINK_STATUSES }).notNull(),
    blocksCreation: integer("blocks_creation", { mode: "boolean" }).notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at"),
    paidAt: text("paid_at"),
    cancelledAt: text("cancelled_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("payment_links_external_link_id_uq").on(table.externalLinkId),
    uniqueIndex("payment_links_reference_id_uq").on(table.referenceId),
    uniqueIndex("payment_links_one_blocking_per_order_uq")
      .on(table.orderId)
      .where(sql`${table.blocksCreation} = 1`),
    index("payment_links_case_id_idx").on(table.caseId),
    index("payment_links_order_updated_idx").on(table.orderId, table.updatedAt),
    check(
      "payment_links_amount_check",
      sql`typeof(${table.amountSubunits}) = 'integer' AND ${table.amountSubunits} >= 0`,
    ),
    check(
      "payment_links_currency_check",
      sql`length(${table.currency}) = 3 AND ${table.currency} = upper(${table.currency})`,
    ),
    check(
      "payment_links_status_check",
      sql`${table.status} IN ('CREATED','PARTIALLY_PAID','PAID','CANCELLED','EXPIRED','FAILED_SAFE')`,
    ),
    check(
      "payment_links_blocking_check",
      sql`${table.blocksCreation} IN (0,1) AND ((${table.status} IN ('CREATED','PARTIALLY_PAID') AND ${table.blocksCreation} = 1) OR (${table.status} IN ('PAID','CANCELLED','EXPIRED','FAILED_SAFE') AND ${table.blocksCreation} = 0))`,
    ),
  ],
);

export const auditEntries = sqliteTable(
  "audit_entries",
  {
    sequence: integer("sequence", { mode: "number" }).primaryKey({
      autoIncrement: true,
    }),
    entryId: text("entry_id").notNull(),
    timestamp: text("timestamp").notNull(),
    actor: text("actor").notNull(),
    inputReference: text("input_reference").notNull(),
    eventType: text("event_type").notNull(),
    reason: text("reason").notNull(),
    previousState: text("previous_state", { enum: RECOVERY_CASE_STATES }),
    newState: text("new_state", { enum: RECOVERY_CASE_STATES }),
    previousHash: text("previous_hash"),
    currentHash: text("current_hash").notNull(),
    metadataJson: text("metadata_json").notNull(),
  },
  (table) => [
    uniqueIndex("audit_entries_entry_id_uq").on(table.entryId),
    index("audit_entries_timestamp_sequence_idx").on(
      table.timestamp,
      table.sequence,
    ),
    check(
      "audit_entries_actor_check",
      sql`${table.actor} IN ('WEBHOOK_INGESTOR','STATE_RECONCILER','KNOWN_ERROR_DIAGNOSER','AI_SCORER','POLICY_FIREWALL','RECOVERY_EXECUTOR','AUDIT_SYSTEM','DIGITAL_TWIN','HUMAN_OPERATOR')`,
    ),
    check(
      "audit_entries_previous_state_check",
      sql`${table.previousState} IS NULL OR ${table.previousState} IN ('DETECTED','VERIFYING','DIAGNOSED','AWAITING_POLICY','WAITING','LINK_CREATED','RECOVERED','STOPPED','ESCALATED','ERROR_SAFE')`,
    ),
    check(
      "audit_entries_new_state_check",
      sql`${table.newState} IS NULL OR ${table.newState} IN ('DETECTED','VERIFYING','DIAGNOSED','AWAITING_POLICY','WAITING','LINK_CREATED','RECOVERED','STOPPED','ESCALATED','ERROR_SAFE')`,
    ),
  ],
);

export const auditChainState = sqliteTable(
  "audit_chain_state",
  {
    chainIdentity: text("chain_identity").primaryKey(),
    chainVersion: text("chain_version").notNull(),
    entryCount: integer("entry_count", { mode: "number" }).notNull(),
    lastSequence: integer("last_sequence", { mode: "number" }).notNull(),
    headHash: text("head_hash"),
  },
  (table) => [
    check(
      "audit_chain_state_count_check",
      sql`typeof(${table.entryCount}) = 'integer' AND ${table.entryCount} >= 0 AND typeof(${table.lastSequence}) = 'integer' AND ${table.lastSequence} = ${table.entryCount}`,
    ),
    check(
      "audit_chain_state_head_check",
      sql`(${table.entryCount} = 0 AND ${table.headHash} IS NULL) OR (${table.entryCount} > 0 AND length(${table.headHash}) = 64 AND ${table.headHash} NOT GLOB '*[^0-9a-f]*')`,
    ),
  ],
);

export const evaluationRuns = sqliteTable(
  "evaluation_runs",
  {
    evaluationRunId: text("evaluation_run_id").primaryKey(),
    seed: text("seed").notNull(),
    completedAt: text("completed_at").notNull(),
    resultJson: text("result_json").notNull(),
    uniqueCaseCount: integer("unique_case_count", { mode: "number" }).notNull(),
    eventDeliveryCount: integer("event_delivery_count", {
      mode: "number",
    }).notNull(),
    simulatedRevenueInitiallyAtRiskSubunits: integer(
      "simulated_revenue_initially_at_risk_subunits",
      { mode: "number" },
    ).notNull(),
    baselineSimulatedRecoverySubunits: integer(
      "baseline_simulated_recovery_subunits",
      { mode: "number" },
    ).notNull(),
    recoverAiSimulatedRecoverySubunits: integer(
      "recoverai_simulated_recovery_subunits",
      { mode: "number" },
    ).notNull(),
    incrementalSimulatedRecoverySubunits: integer(
      "incremental_simulated_recovery_subunits",
      { mode: "number" },
    ).notNull(),
    currency: text("currency").notNull(),
    unsafeActionsBlocked: integer("unsafe_actions_blocked", {
      mode: "number",
    }).notNull(),
    duplicateEventsIgnored: integer("duplicate_events_ignored", {
      mode: "number",
    }).notNull(),
    unresolvedExceptionCount: integer("unresolved_exception_count", {
      mode: "number",
    }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("evaluation_runs_completed_at_idx").on(table.completedAt),
    check(
      "evaluation_runs_counts_check",
      sql`typeof(${table.uniqueCaseCount}) = 'integer' AND ${table.uniqueCaseCount} > 0 AND typeof(${table.eventDeliveryCount}) = 'integer' AND ${table.eventDeliveryCount} > 0 AND typeof(${table.unsafeActionsBlocked}) = 'integer' AND ${table.unsafeActionsBlocked} >= 0 AND typeof(${table.duplicateEventsIgnored}) = 'integer' AND ${table.duplicateEventsIgnored} >= 0 AND typeof(${table.unresolvedExceptionCount}) = 'integer' AND ${table.unresolvedExceptionCount} >= 0`,
    ),
    check(
      "evaluation_runs_money_check",
      sql`typeof(${table.simulatedRevenueInitiallyAtRiskSubunits}) = 'integer' AND ${table.simulatedRevenueInitiallyAtRiskSubunits} >= 0 AND typeof(${table.baselineSimulatedRecoverySubunits}) = 'integer' AND ${table.baselineSimulatedRecoverySubunits} >= 0 AND typeof(${table.recoverAiSimulatedRecoverySubunits}) = 'integer' AND ${table.recoverAiSimulatedRecoverySubunits} >= 0 AND typeof(${table.incrementalSimulatedRecoverySubunits}) = 'integer'`,
    ),
    check(
      "evaluation_runs_currency_check",
      sql`length(${table.currency}) = 3 AND ${table.currency} = upper(${table.currency})`,
    ),
  ],
);

export const demoScenarioRuns = sqliteTable(
  "demo_scenario_runs",
  {
    scenarioKey: text("scenario_key", {
      enum: DEMO_SCENARIO_KEYS,
    }).primaryKey(),
    resultJson: text("result_json").notNull(),
    completedAt: text("completed_at").notNull(),
  },
  (table) => [
    check(
      "demo_scenario_runs_key_check",
      sql`${table.scenarioKey} IN ('DUPLICATE_DELIVERY','OUT_OF_ORDER','LATE_SUCCESS','INVALID_AI_AMOUNT','AI_TIMEOUT','DOWNTIME_FAILURE')`,
    ),
  ],
);

export const testModeLinkAttempts = sqliteTable(
  "test_mode_link_attempts",
  {
    attemptId: text("attempt_id").primaryKey(),
    referenceId: text("reference_id").notNull(),
    outcome: text("outcome", {
      enum: ["CLAIMED", "CREATED", "FAILED_SAFE", "OUTCOME_UNCERTAIN"],
    }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("test_mode_link_attempts_reference_uq").on(table.referenceId),
    check(
      "test_mode_link_attempts_outcome_check",
      sql`${table.outcome} IN ('CLAIMED','CREATED','FAILED_SAFE','OUTCOME_UNCERTAIN')`,
    ),
  ],
);

export const recoverAiSchema = {
  webhookEvents,
  paymentSnapshots,
  recoveryCases,
  aiRecommendations,
  policyDecisions,
  recoveryActions,
  paymentLinks,
  auditEntries,
  auditChainState,
  evaluationRuns,
  demoScenarioRuns,
  testModeLinkAttempts,
};
