-- Add created_at_utc column to recruit_entries table
ALTER TABLE `recruit_entries` ADD COLUMN `created_at_utc` text NOT NULL DEFAULT '';
