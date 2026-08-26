CREATE TABLE `test_mode_link_attempts` (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`reference_id` text NOT NULL,
	`outcome` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `test_mode_link_attempts_outcome_check` CHECK (`outcome` IN ('CLAIMED','CREATED','FAILED_SAFE','OUTCOME_UNCERTAIN'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `test_mode_link_attempts_reference_uq` ON `test_mode_link_attempts` (`reference_id`);
--> statement-breakpoint
PRAGMA legacy_alter_table=ON;
--> statement-breakpoint
ALTER TABLE `webhook_events` RENAME TO `webhook_events_legacy`;
--> statement-breakpoint
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
	CONSTRAINT `webhook_events_event_name_check` CHECK (`event_name` IN ('payment.failed','payment.authorized','payment.captured','order.paid','payment.downtime.started','payment.downtime.resolved','payment.downtime.updated','payment_link.paid','payment_link.partially_paid','payment_link.cancelled','payment_link.expired')),
	CONSTRAINT `webhook_events_signature_status_check` CHECK (`signature_status` IN ('VERIFIED','REJECTED','NOT_CHECKED')),
	CONSTRAINT `webhook_events_processing_status_check` CHECK (`processing_status` IN ('FIRST_SEEN','DUPLICATE','NOT_CHECKED')),
	CONSTRAINT `webhook_events_payload_digest_check` CHECK (`payload_digest` IS NULL OR (`payload_digest` NOT GLOB '*[^0-9a-f]*' AND length(`payload_digest`) = 64))
);
--> statement-breakpoint
INSERT INTO `webhook_events` SELECT * FROM `webhook_events_legacy`;
--> statement-breakpoint
ALTER TABLE `payment_snapshots` RENAME TO `payment_snapshots_legacy`;
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
	`snapshot_origin` text DEFAULT 'WEBHOOK_EVIDENCE' NOT NULL,
	FOREIGN KEY (`source_event_id`) REFERENCES `webhook_events`(`id`),
	CONSTRAINT `payment_snapshots_amount_check` CHECK (typeof(`amount_subunits`) = 'integer' AND `amount_subunits` >= 0),
	CONSTRAINT `payment_snapshots_currency_check` CHECK (length(`currency`) = 3 AND `currency` = upper(`currency`)),
	CONSTRAINT `payment_snapshots_status_check` CHECK (`status` IN ('CREATED','AUTHORIZED','CAPTURED','FAILED','UNKNOWN')),
	CONSTRAINT `payment_snapshots_origin_check` CHECK (`snapshot_origin` IN ('WEBHOOK_EVIDENCE','PROVIDER_RECONCILED'))
);
--> statement-breakpoint
INSERT INTO `payment_snapshots` SELECT * FROM `payment_snapshots_legacy`;
--> statement-breakpoint
DROP TABLE `payment_snapshots_legacy`;
--> statement-breakpoint
DROP TABLE `webhook_events_legacy`;
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_events_provider_event_id_uq` ON `webhook_events` (`provider_event_id`);
--> statement-breakpoint
CREATE INDEX `webhook_events_payment_id_idx` ON `webhook_events` (`payment_id`);
--> statement-breakpoint
CREATE INDEX `webhook_events_order_id_idx` ON `webhook_events` (`order_id`);
--> statement-breakpoint
CREATE INDEX `webhook_events_received_at_idx` ON `webhook_events` (`received_at`);
--> statement-breakpoint
CREATE INDEX `payment_snapshots_payment_latest_idx` ON `payment_snapshots` (`payment_id`,`observed_at`,`snapshot_sequence`);
--> statement-breakpoint
CREATE INDEX `payment_snapshots_order_id_idx` ON `payment_snapshots` (`order_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_snapshots_source_origin_uq` ON `payment_snapshots` (`source_event_id`,`snapshot_origin`);
--> statement-breakpoint
PRAGMA legacy_alter_table=OFF;
