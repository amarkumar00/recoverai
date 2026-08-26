CREATE TABLE `demo_scenario_runs` (
	`scenario_key` text PRIMARY KEY NOT NULL,
	`result_json` text NOT NULL,
	`completed_at` text NOT NULL,
	CONSTRAINT "demo_scenario_runs_key_check" CHECK(`scenario_key` IN ('DUPLICATE_DELIVERY','OUT_OF_ORDER','LATE_SUCCESS','INVALID_AI_AMOUNT','AI_TIMEOUT','DOWNTIME_FAILURE'))
);
