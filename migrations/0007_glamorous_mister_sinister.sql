PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_recruit_entries` (
	`recruit_id` text NOT NULL,
	`user_id` text NOT NULL,
	`state` text NOT NULL,
	`available_from_utc` text,
	`created_at_utc` text NOT NULL,
	`updated_at_utc` text NOT NULL,
	`last_reminded_at_utc` text,
	PRIMARY KEY(`recruit_id`, `user_id`),
	FOREIGN KEY (`recruit_id`) REFERENCES `recruits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_recruit_entries`("recruit_id", "user_id", "state", "available_from_utc", "created_at_utc", "updated_at_utc", "last_reminded_at_utc") SELECT "recruit_id", "user_id", "state", "available_from_utc", "created_at_utc", "updated_at_utc", "last_reminded_at_utc" FROM `recruit_entries`;--> statement-breakpoint
DROP TABLE `recruit_entries`;--> statement-breakpoint
ALTER TABLE `__new_recruit_entries` RENAME TO `recruit_entries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;