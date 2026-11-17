CREATE TABLE `translation_cache` (
	`input_hash` text PRIMARY KEY NOT NULL,
	`translated_text` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `translation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`system_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`source_hash` text NOT NULL,
	`prompt_version` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`lease_token` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`retry_at` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `translation_source_version` ON `translation_jobs` (`system_id`,`source_revision`,`prompt_version`);