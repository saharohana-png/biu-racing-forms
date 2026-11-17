CREATE TABLE `email_entry_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text
);
