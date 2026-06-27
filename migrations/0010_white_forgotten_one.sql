CREATE TABLE `recruit_entry_drafts` (
	`recruit_id` text NOT NULL,
	`user_id` text NOT NULL,
	`available_from_utc` text,
	`party_size_preference` text,
	`created_at_utc` text NOT NULL,
	`updated_at_utc` text NOT NULL,
	PRIMARY KEY(`recruit_id`, `user_id`),
	FOREIGN KEY (`recruit_id`) REFERENCES `recruits`(`id`) ON UPDATE no action ON DELETE cascade
);
