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
ALTER TABLE `user_settings` ADD `text_llm_provider` text DEFAULT 'anthropic' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `text_llm_api_key` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `text_llm_model` text DEFAULT 'claude-sonnet-4-20250514' NOT NULL;