ALTER TABLE `user_settings` ADD `text_llm_provider` text DEFAULT 'anthropic' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `text_llm_api_key` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `text_llm_model` text DEFAULT 'claude-sonnet-4-20250514' NOT NULL;