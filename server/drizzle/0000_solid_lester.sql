CREATE TABLE `challenge_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`landmark_id` text NOT NULL,
	`team_id` text NOT NULL,
	`outcome` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `event_log` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`timestamp` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `event_log_game_type_idx` ON `event_log` (`game_id`,`type`);--> statement-breakpoint
CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`join_code` text NOT NULL,
	`map_id` text NOT NULL,
	`status` text NOT NULL,
	`config` text NOT NULL,
	`started_at` text,
	`paused_at` text,
	`total_paused_ms` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `games_join_code_unique` ON `games` (`join_code`);--> statement-breakpoint
CREATE TABLE `landmark_state` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`landmark_id` text NOT NULL,
	`team_id` text,
	`locked` integer NOT NULL,
	`claimed_at` text,
	`claim_photo_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `landmark_state_game_landmark_idx` ON `landmark_state` (`game_id`,`landmark_id`);--> statement-breakpoint
CREATE TABLE `landmarks` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`name` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`image_url` text,
	`challenge_text` text,
	`map_landmark_index` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `location_pings` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`team_id` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`timestamp` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `location_pings_game_timestamp_idx` ON `location_pings` (`game_id`,`timestamp`);--> statement-breakpoint
CREATE TABLE `maps` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`center_lat` real NOT NULL,
	`center_lng` real NOT NULL,
	`default_zoom` integer NOT NULL,
	`default_vicinity_radius` integer NOT NULL,
	`win_threshold` integer NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`team_id` text NOT NULL,
	`landmark_id` text NOT NULL,
	`filename` text NOT NULL,
	`url` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `push_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`team_id` text NOT NULL,
	`token` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tag_events` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`tagger_team_id` text NOT NULL,
	`target_team_id` text NOT NULL,
	`timestamp` text NOT NULL,
	`disputed` integer NOT NULL,
	`voided` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL
);
