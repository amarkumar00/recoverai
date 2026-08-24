CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_event_id` text NOT NULL,
	`event_name` text NOT NULL,
	`occurred_at` text NOT NULL,
	`received_at` text NOT NULL,
	`signature_status` text NOT NULL,
	`processing_status` text NOT NULL,
	`payment_id` text,
	`order_id` text,
	`recovery_link_id` text,
	`normalized_event_json` text NOT NULL,
	`payload_digest` text,
	`created_at` text NOT NULL,
	`processed_at` text,
	`safe_error_reason` text,
	CONSTRAINT `webhook_events_event_name_check` CHECK (`event_name` IN ('payment.failed','payment.authorized','payment.captured','order.paid','payment_link.paid','payment_link.partially_paid','payment_link.cancelled','payment_link.expired')),
	CONSTRAINT `webhook_events_signature_status_check` CHECK (`signature_status` IN ('VERIFIED','REJECTED','NOT_CHECKED')),
	CONSTRAINT `webhook_events_processing_status_check` CHECK (`processing_status` IN ('FIRST_SEEN','DUPLICATE','NOT_CHECKED')),
	CONSTRAINT `webhook_events_payload_digest_check` CHECK (`payload_digest` IS NULL OR (`payload_digest` NOT GLOB '*[^0-9a-f]*' AND length(`payload_digest`) = 64))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_events_provider_event_id_uq` ON `webhook_events` (`provider_event_id`);
--> statement-breakpoint
CREATE INDEX `webhook_events_payment_id_idx` ON `webhook_events` (`payment_id`);
--> statement-breakpoint
CREATE INDEX `webhook_events_order_id_idx` ON `webhook_events` (`order_id`);
--> statement-breakpoint
CREATE INDEX `webhook_events_received_at_idx` ON `webhook_events` (`received_at`);
--> statement-breakpoint
CREATE TABLE `payment_snapshots` (
	`snapshot_sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payment_id` text NOT NULL,
	`order_id` text NOT NULL,
	`amount_subunits` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text NOT NULL,
	`method` text NOT NULL,
	`bank_or_provider` text,
	`failure_json` text,
	`provider_created_at` text NOT NULL,
	`observed_at` text NOT NULL,
	`source_event_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_event_id`) REFERENCES `webhook_events`(`id`),
	CONSTRAINT `payment_snapshots_amount_check` CHECK (typeof(`amount_subunits`) = 'integer' AND `amount_subunits` >= 0),
	CONSTRAINT `payment_snapshots_currency_check` CHECK (length(`currency`) = 3 AND `currency` = upper(`currency`)),
	CONSTRAINT `payment_snapshots_status_check` CHECK (`status` IN ('CREATED','AUTHORIZED','CAPTURED','FAILED','UNKNOWN'))
);
--> statement-breakpoint
CREATE INDEX `payment_snapshots_payment_latest_idx` ON `payment_snapshots` (`payment_id`,`observed_at`,`snapshot_sequence`);
--> statement-breakpoint
CREATE INDEX `payment_snapshots_order_id_idx` ON `payment_snapshots` (`order_id`);
--> statement-breakpoint
CREATE TABLE `recovery_cases` (
	`case_id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`order_id` text NOT NULL,
	`synthetic_customer_hash` text NOT NULL,
	`verified_unpaid_amount_subunits` integer NOT NULL,
	`currency` text NOT NULL,
	`state` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`previous_success_count` integer NOT NULL,
	`previous_failure_count` integer NOT NULL,
	`contact_count` integer NOT NULL,
	`recovery_window_starts_at` text,
	`recovery_window_ends_at` text,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `recovery_cases_amount_check` CHECK (typeof(`verified_unpaid_amount_subunits`) = 'integer' AND `verified_unpaid_amount_subunits` >= 0),
	CONSTRAINT `recovery_cases_currency_check` CHECK (length(`currency`) = 3 AND `currency` = upper(`currency`)),
	CONSTRAINT `recovery_cases_state_check` CHECK (`state` IN ('DETECTED','VERIFYING','DIAGNOSED','AWAITING_POLICY','WAITING','LINK_CREATED','RECOVERED','STOPPED','ESCALATED','ERROR_SAFE')),
	CONSTRAINT `recovery_cases_attempt_check` CHECK (typeof(`attempt_number`) = 'integer' AND `attempt_number` >= 1),
	CONSTRAINT `recovery_cases_counts_check` CHECK (typeof(`previous_success_count`) = 'integer' AND `previous_success_count` >= 0 AND typeof(`previous_failure_count`) = 'integer' AND `previous_failure_count` >= 0 AND typeof(`contact_count`) = 'integer' AND `contact_count` >= 0),
	CONSTRAINT `recovery_cases_version_check` CHECK (typeof(`version`) = 'integer' AND `version` >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recovery_cases_payment_id_uq` ON `recovery_cases` (`payment_id`);
--> statement-breakpoint
CREATE INDEX `recovery_cases_order_id_idx` ON `recovery_cases` (`order_id`);
--> statement-breakpoint
CREATE INDEX `recovery_cases_state_updated_idx` ON `recovery_cases` (`state`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `ai_recommendations` (
	`recommendation_id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`recommendation_json` text NOT NULL,
	`selected_action` text NOT NULL,
	`confidence_millionths` integer NOT NULL,
	`context_status` text NOT NULL,
	`escalation_recommended` integer NOT NULL,
	`recommended_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `recovery_cases`(`case_id`),
	CONSTRAINT `ai_recommendations_action_check` CHECK (`selected_action` IN ('WAIT_FOR_RECOVERY','SEND_PAYMENT_LINK','REQUEST_METHOD_CHANGE','CANCEL_RECOVERY_ALREADY_PAID','STOP_NON_RETRYABLE','ESCALATE_HUMAN')),
	CONSTRAINT `ai_recommendations_confidence_check` CHECK (typeof(`confidence_millionths`) = 'integer' AND `confidence_millionths` BETWEEN 0 AND 1000000),
	CONSTRAINT `ai_recommendations_context_check` CHECK (`context_status` IN ('SUFFICIENT','INSUFFICIENT')),
	CONSTRAINT `ai_recommendations_escalation_check` CHECK (`escalation_recommended` IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `ai_recommendations_case_recommended_idx` ON `ai_recommendations` (`case_id`,`recommended_at`);
--> statement-breakpoint
CREATE TABLE `policy_decisions` (
	`decision_id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`decision_json` text NOT NULL,
	`proposed_action` text NOT NULL,
	`final_action` text,
	`outcome` text NOT NULL,
	`rule_id` text NOT NULL,
	`reason` text NOT NULL,
	`case_state` text NOT NULL,
	`decided_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `recovery_cases`(`case_id`),
	CONSTRAINT `policy_decisions_proposed_action_check` CHECK (`proposed_action` IN ('WAIT_FOR_RECOVERY','SEND_PAYMENT_LINK','REQUEST_METHOD_CHANGE','CANCEL_RECOVERY_ALREADY_PAID','STOP_NON_RETRYABLE','ESCALATE_HUMAN')),
	CONSTRAINT `policy_decisions_final_action_check` CHECK (`final_action` IS NULL OR `final_action` IN ('WAIT_FOR_RECOVERY','SEND_PAYMENT_LINK','REQUEST_METHOD_CHANGE','CANCEL_RECOVERY_ALREADY_PAID','STOP_NON_RETRYABLE','ESCALATE_HUMAN')),
	CONSTRAINT `policy_decisions_outcome_check` CHECK (`outcome` IN ('APPROVED','BLOCKED','ESCALATED','STOPPED')),
	CONSTRAINT `policy_decisions_state_check` CHECK (`case_state` IN ('DETECTED','VERIFYING','DIAGNOSED','AWAITING_POLICY','WAITING','LINK_CREATED','RECOVERED','STOPPED','ESCALATED','ERROR_SAFE'))
);
--> statement-breakpoint
CREATE INDEX `policy_decisions_case_decided_idx` ON `policy_decisions` (`case_id`,`decided_at`);
--> statement-breakpoint
CREATE TABLE `recovery_actions` (
	`action_record_id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`action` text NOT NULL,
	`status` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`attempt_count` integer NOT NULL,
	`safe_result_code` text,
	`safe_result_detail` text,
	`safe_error_reason` text,
	`requested_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `recovery_cases`(`case_id`),
	CONSTRAINT `recovery_actions_action_check` CHECK (`action` IN ('WAIT_FOR_RECOVERY','SEND_PAYMENT_LINK','REQUEST_METHOD_CHANGE','CANCEL_RECOVERY_ALREADY_PAID','STOP_NON_RETRYABLE','ESCALATE_HUMAN')),
	CONSTRAINT `recovery_actions_status_check` CHECK (`status` IN ('REQUESTED','STARTED','SUCCEEDED','FAILED_SAFE','CANCELLED')),
	CONSTRAINT `recovery_actions_attempt_count_check` CHECK (typeof(`attempt_count`) = 'integer' AND `attempt_count` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recovery_actions_idempotency_key_uq` ON `recovery_actions` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `recovery_actions_case_requested_idx` ON `recovery_actions` (`case_id`,`requested_at`);
--> statement-breakpoint
CREATE TABLE `payment_links` (
	`recovery_link_id` text PRIMARY KEY NOT NULL,
	`external_link_id` text,
	`case_id` text NOT NULL,
	`order_id` text NOT NULL,
	`reference_id` text NOT NULL,
	`amount_subunits` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text NOT NULL,
	`blocks_creation` integer NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text,
	`paid_at` text,
	`cancelled_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `recovery_cases`(`case_id`),
	CONSTRAINT `payment_links_amount_check` CHECK (typeof(`amount_subunits`) = 'integer' AND `amount_subunits` >= 0),
	CONSTRAINT `payment_links_currency_check` CHECK (length(`currency`) = 3 AND `currency` = upper(`currency`)),
	CONSTRAINT `payment_links_status_check` CHECK (`status` IN ('CREATED','PARTIALLY_PAID','PAID','CANCELLED','EXPIRED','FAILED_SAFE')),
	CONSTRAINT `payment_links_blocks_boolean_check` CHECK (`blocks_creation` IN (0,1)),
	CONSTRAINT `payment_links_blocking_check` CHECK (((`status` IN ('CREATED','PARTIALLY_PAID') AND `blocks_creation` = 1) OR (`status` IN ('PAID','CANCELLED','EXPIRED','FAILED_SAFE') AND `blocks_creation` = 0)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_links_external_link_id_uq` ON `payment_links` (`external_link_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_links_reference_id_uq` ON `payment_links` (`reference_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_links_one_blocking_per_order_uq` ON `payment_links` (`order_id`) WHERE `blocks_creation` = 1;
--> statement-breakpoint
CREATE INDEX `payment_links_case_id_idx` ON `payment_links` (`case_id`);
--> statement-breakpoint
CREATE INDEX `payment_links_order_updated_idx` ON `payment_links` (`order_id`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `audit_entries` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entry_id` text NOT NULL,
	`timestamp` text NOT NULL,
	`actor` text NOT NULL,
	`input_reference` text NOT NULL,
	`event_type` text NOT NULL,
	`reason` text NOT NULL,
	`previous_state` text,
	`new_state` text,
	`previous_hash` text,
	`current_hash` text NOT NULL,
	`metadata_json` text NOT NULL,
	CONSTRAINT `audit_entries_actor_check` CHECK (`actor` IN ('WEBHOOK_INGESTOR','STATE_RECONCILER','KNOWN_ERROR_DIAGNOSER','AI_SCORER','POLICY_FIREWALL','RECOVERY_EXECUTOR','AUDIT_SYSTEM','DIGITAL_TWIN','HUMAN_OPERATOR')),
	CONSTRAINT `audit_entries_previous_state_check` CHECK (`previous_state` IS NULL OR `previous_state` IN ('DETECTED','VERIFYING','DIAGNOSED','AWAITING_POLICY','WAITING','LINK_CREATED','RECOVERED','STOPPED','ESCALATED','ERROR_SAFE')),
	CONSTRAINT `audit_entries_new_state_check` CHECK (`new_state` IS NULL OR `new_state` IN ('DETECTED','VERIFYING','DIAGNOSED','AWAITING_POLICY','WAITING','LINK_CREATED','RECOVERED','STOPPED','ESCALATED','ERROR_SAFE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_entries_entry_id_uq` ON `audit_entries` (`entry_id`);
--> statement-breakpoint
CREATE INDEX `audit_entries_timestamp_sequence_idx` ON `audit_entries` (`timestamp`,`sequence`);
--> statement-breakpoint
CREATE TABLE `evaluation_runs` (
	`evaluation_run_id` text PRIMARY KEY NOT NULL,
	`seed` text NOT NULL,
	`completed_at` text NOT NULL,
	`result_json` text NOT NULL,
	`unique_case_count` integer NOT NULL,
	`event_delivery_count` integer NOT NULL,
	`simulated_revenue_initially_at_risk_subunits` integer NOT NULL,
	`baseline_simulated_recovery_subunits` integer NOT NULL,
	`recoverai_simulated_recovery_subunits` integer NOT NULL,
	`incremental_simulated_recovery_subunits` integer NOT NULL,
	`currency` text NOT NULL,
	`unsafe_actions_blocked` integer NOT NULL,
	`duplicate_events_ignored` integer NOT NULL,
	`unresolved_exception_count` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `evaluation_runs_counts_check` CHECK (typeof(`unique_case_count`) = 'integer' AND `unique_case_count` > 0 AND typeof(`event_delivery_count`) = 'integer' AND `event_delivery_count` > 0 AND typeof(`unsafe_actions_blocked`) = 'integer' AND `unsafe_actions_blocked` >= 0 AND typeof(`duplicate_events_ignored`) = 'integer' AND `duplicate_events_ignored` >= 0 AND typeof(`unresolved_exception_count`) = 'integer' AND `unresolved_exception_count` >= 0),
	CONSTRAINT `evaluation_runs_money_check` CHECK (typeof(`simulated_revenue_initially_at_risk_subunits`) = 'integer' AND `simulated_revenue_initially_at_risk_subunits` >= 0 AND typeof(`baseline_simulated_recovery_subunits`) = 'integer' AND `baseline_simulated_recovery_subunits` >= 0 AND typeof(`recoverai_simulated_recovery_subunits`) = 'integer' AND `recoverai_simulated_recovery_subunits` >= 0 AND typeof(`incremental_simulated_recovery_subunits`) = 'integer'),
	CONSTRAINT `evaluation_runs_currency_check` CHECK (length(`currency`) = 3 AND `currency` = upper(`currency`))
);
--> statement-breakpoint
CREATE INDEX `evaluation_runs_completed_at_idx` ON `evaluation_runs` (`completed_at`);
