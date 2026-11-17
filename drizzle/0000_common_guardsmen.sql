CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`system_id` text NOT NULL,
	`field_id` text NOT NULL,
	`original_name` text NOT NULL,
	`safe_name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text,
	`storage_key` text NOT NULL,
	`state` text NOT NULL,
	`replaces_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	`mutation_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachment_mutation` ON `attachments` (`mutation_key`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`system_id` text,
	`action` text NOT NULL,
	`revision` integer,
	`actor` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`role` text NOT NULL,
	`system_ids` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_by` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`subject` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`system_ids` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mutations` (
	`id` text PRIMARY KEY NOT NULL,
	`system_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `review_events` (
	`id` text PRIMARY KEY NOT NULL,
	`system_id` text NOT NULL,
	`revision` integer NOT NULL,
	`action` text NOT NULL,
	`reason` text NOT NULL,
	`field_ids` text NOT NULL,
	`actor` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`system_id` text NOT NULL,
	`revision` integer NOT NULL,
	`answers` text NOT NULL,
	`status` text NOT NULL,
	`review` text NOT NULL,
	`schema_version` text NOT NULL,
	`content_hash` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	`mutation_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `revision_system_version` ON `revisions` (`system_id`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `revision_mutation` ON `revisions` (`mutation_key`);--> statement-breakpoint
CREATE TABLE `shared_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`value` text NOT NULL,
	`unit` text NOT NULL,
	`source` text NOT NULL,
	`base_revision` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shared_records` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`system_ids` text NOT NULL,
	`value` text NOT NULL,
	`unit` text NOT NULL,
	`source` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shared_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`revision` integer NOT NULL,
	`value` text NOT NULL,
	`unit` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_record_revision` ON `shared_revisions` (`record_id`,`revision`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`answers` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`review` text DEFAULT '{}' NOT NULL,
	`updated_at` text NOT NULL,
	`last_mutation` text
);
--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_subject` text NOT NULL,
	`created_at` text NOT NULL
);
