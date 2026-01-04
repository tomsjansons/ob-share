CREATE TABLE `job_phases` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`name` text NOT NULL,
	`order` integer NOT NULL,
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
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
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
CREATE TABLE `queue_lock` (
	`id` text PRIMARY KEY DEFAULT 'global' NOT NULL,
	`handler_id` text NOT NULL,
	`acquired_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
