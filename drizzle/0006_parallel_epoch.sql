ALTER TABLE `user_settings` ADD `openai_api_key` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `openai_model` text DEFAULT 'gpt-4o-audio-preview' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `max_retries` integer DEFAULT 5 NOT NULL;