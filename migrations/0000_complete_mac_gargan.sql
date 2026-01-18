CREATE TABLE `guild_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Tokyo' NOT NULL,
	`default_interval_min` integer DEFAULT 30 NOT NULL,
	`default_duration_min` integer DEFAULT 360 NOT NULL,
	`default_template` text DEFAULT '' NOT NULL,
	`reminder_interval_min` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guild_settings_guild_id_unique` ON `guild_settings` (`guild_id`);--> statement-breakpoint
CREATE TABLE `recruit_entries` (
	`recruit_id` text NOT NULL,
	`user_id` text NOT NULL,
	`state` text DEFAULT 'pending_time' NOT NULL,
	`available_from_utc` text,
	`updated_at_utc` text NOT NULL,
	`last_reminded_at_utc` text,
	FOREIGN KEY (`recruit_id`) REFERENCES `recruits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `recruits` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text NOT NULL,
	`target_date_local` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`match_signature` text,
	`last_notified_signature` text,
	`matched_meet_time_utc` text,
	`matched_member_ids_json` text,
	`deleted_by` text,
	`deleted_at_utc` text
);
--> statement-breakpoint
CREATE TABLE `riot_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`game_name` text NOT NULL,
	`tag_line` text NOT NULL,
	`region` text DEFAULT 'na' NOT NULL,
	`rank` text NOT NULL,
	`created_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`creator_id` text NOT NULL,
	`post_time_hhmm` text NOT NULL,
	`interval_min` integer DEFAULT 30 NOT NULL,
	`duration_min` integer DEFAULT 360 NOT NULL,
	`template` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL
);
