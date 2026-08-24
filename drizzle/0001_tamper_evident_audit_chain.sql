CREATE TABLE `audit_chain_state` (
	`chain_identity` text PRIMARY KEY NOT NULL,
	`chain_version` text NOT NULL,
	`entry_count` integer NOT NULL,
	`last_sequence` integer NOT NULL,
	`head_hash` text,
	CONSTRAINT `audit_chain_state_count_check` CHECK (typeof(`entry_count`) = 'integer' AND `entry_count` >= 0 AND typeof(`last_sequence`) = 'integer' AND `last_sequence` = `entry_count`),
	CONSTRAINT `audit_chain_state_head_check` CHECK ((`entry_count` = 0 AND `head_hash` IS NULL) OR (`entry_count` > 0 AND length(`head_hash`) = 64 AND `head_hash` NOT GLOB '*[^0-9a-f]*'))
);
--> statement-breakpoint
INSERT INTO `audit_chain_state` (`chain_identity`, `chain_version`, `entry_count`, `last_sequence`, `head_hash`)
VALUES ('RECOVERAI_GLOBAL_AUDIT', 'RECOVERAI_AUDIT_V1', 0, 0, NULL);
