CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `allow_list` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`github_username` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `allow_list_github_username_unique` ON `allow_list` (`github_username`);--> statement-breakpoint
CREATE TABLE `job_phases` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`name` text NOT NULL,
	`phase_order` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`input` text,
	`output` text,
	`error` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`max_retries` integer DEFAULT 3 NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `job_phases_job_id_idx` ON `job_phases` (`job_id`);--> statement-breakpoint
CREATE INDEX `job_phases_status_idx` ON `job_phases` (`status`);--> statement-breakpoint
CREATE INDEX `job_phases_job_order_idx` ON `job_phases` (`job_id`,`phase_order`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`payload` text NOT NULL,
	`result` text,
	`max_retries` integer DEFAULT 3 NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`visible_at` integer NOT NULL,
	`scheduled_for` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`user_id` text,
	`handler_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `jobs_type_idx` ON `jobs` (`type`);--> statement-breakpoint
CREATE INDEX `jobs_user_id_idx` ON `jobs` (`user_id`);--> statement-breakpoint
CREATE INDEX `jobs_visible_at_idx` ON `jobs` (`visible_at`);--> statement-breakpoint
CREATE INDEX `jobs_scheduled_for_idx` ON `jobs` (`scheduled_for`);--> statement-breakpoint
CREATE INDEX `jobs_handler_id_idx` ON `jobs` (`handler_id`);--> statement-breakpoint
CREATE INDEX `jobs_status_visible_scheduled_idx` ON `jobs` (`status`,`visible_at`,`scheduled_for`);--> statement-breakpoint
CREATE TABLE `periodic_job_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`job_type` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`interval_ms` integer NOT NULL,
	`payload_template` text,
	`last_run_at` integer,
	`next_run_at` integer,
	`last_job_id` text,
	`total_runs` integer DEFAULT 0 NOT NULL,
	`successful_runs` integer DEFAULT 0 NOT NULL,
	`failed_runs` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `periodic_job_schedules_job_type_unique` ON `periodic_job_schedules` (`job_type`);--> statement-breakpoint
CREATE INDEX `periodic_job_schedules_enabled_idx` ON `periodic_job_schedules` (`enabled`);--> statement-breakpoint
CREATE INDEX `periodic_job_schedules_next_run_idx` ON `periodic_job_schedules` (`next_run_at`);--> statement-breakpoint
CREATE TABLE `queue_handler_heartbeat` (
	`id` text PRIMARY KEY NOT NULL,
	`last_heartbeat` integer NOT NULL,
	`status` text DEFAULT 'alive' NOT NULL,
	`hostname` text,
	`pid` integer,
	`version` text,
	`jobs_processed` integer DEFAULT 0 NOT NULL,
	`jobs_failed` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`stopped_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `queue_handler_heartbeat_status_idx` ON `queue_handler_heartbeat` (`status`);--> statement-breakpoint
CREATE TABLE `queue_lock` (
	`id` text PRIMARY KEY DEFAULT 'global' NOT NULL,
	`handler_id` text NOT NULL,
	`acquired_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`vault_name` text,
	`incoming_folder` text,
	`location_permission` text DEFAULT 'not_asked' NOT NULL,
	`audio_permission` text DEFAULT 'not_asked' NOT NULL,
	`file_check_interval` integer DEFAULT 10 NOT NULL,
	`openai_api_key` text,
	`openai_model` text DEFAULT 'gpt-4o-audio-preview' NOT NULL,
	`text_llm_provider` text DEFAULT 'anthropic' NOT NULL,
	`text_llm_api_key` text,
	`text_llm_model` text DEFAULT 'claude-sonnet-4-20250514' NOT NULL,
	`document_analysis_model` text DEFAULT 'gpt-4o' NOT NULL,
	`max_retries` integer DEFAULT 5 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_settings_user_id_unique` ON `user_settings` (`user_id`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
