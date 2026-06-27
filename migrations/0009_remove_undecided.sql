PRAGMA foreign_keys=OFF;
CREATE TABLE `__new_recruit_entries` (
	`recruit_id` text NOT NULL,
	`user_id` text NOT NULL,
	`available_from_utc` text NOT NULL,
	`party_size_preference` text DEFAULT 'any' NOT NULL,
	`created_at_utc` text NOT NULL,
	`updated_at_utc` text NOT NULL,
	PRIMARY KEY(`recruit_id`, `user_id`),
	FOREIGN KEY (`recruit_id`) REFERENCES `recruits`(`id`) ON UPDATE no action ON DELETE cascade
);
DROP TABLE `recruit_entries`;
ALTER TABLE `__new_recruit_entries` RENAME TO `recruit_entries`;
ALTER TABLE `guild_settings` DROP COLUMN `reminder_interval_min`;
PRAGMA foreign_keys=ON;
