ALTER TABLE `payment_snapshots` ADD `snapshot_origin` text DEFAULT 'WEBHOOK_EVIDENCE' NOT NULL CHECK (`snapshot_origin` IN ('WEBHOOK_EVIDENCE','PROVIDER_RECONCILED'));
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_snapshots_source_origin_uq` ON `payment_snapshots` (`source_event_id`,`snapshot_origin`);
