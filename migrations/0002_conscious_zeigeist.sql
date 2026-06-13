CREATE TABLE `api_rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`api_name` text NOT NULL,
	`requested_at_utc` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `riot_accounts` ADD `last_fetched_at_utc` text NOT NULL;