CREATE TABLE IF NOT EXISTS "maps" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"center_lat" double precision NOT NULL,
	"center_lng" double precision NOT NULL,
	"default_zoom" integer NOT NULL,
	"default_vicinity_radius" integer NOT NULL,
	"win_threshold" integer NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "games" (
	"id" text PRIMARY KEY NOT NULL,
	"join_code" text NOT NULL UNIQUE,
	"map_id" text NOT NULL,
	"status" text NOT NULL,
	"config" jsonb NOT NULL,
	"started_at" text,
	"paused_at" text,
	"total_paused_ms" integer NOT NULL,
	"host_team_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "landmarks" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"name" text NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"image_url" text,
	"challenge_text" text,
	"challenge" jsonb,
	"map_landmark_index" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "landmark_state" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"landmark_id" text NOT NULL,
	"team_id" text,
	"locked" boolean NOT NULL,
	"claimed_at" text,
	"claim_photo_id" text,
	CONSTRAINT "landmark_state_game_landmark_idx" UNIQUE("game_id", "landmark_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "challenge_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"landmark_id" text NOT NULL,
	"team_id" text NOT NULL,
	"status" text NOT NULL,
	"outcome" text,
	"started_at" text NOT NULL,
	"ready_at" text,
	"completed_at" text,
	"penalty_until" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "penalties" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"team_id" text NOT NULL,
	"type" text NOT NULL,
	"until" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "location_pings" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"team_id" text NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"timestamp" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "location_pings_game_timestamp_idx" ON "location_pings" ("game_id", "timestamp");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tag_events" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"tagger_team_id" text NOT NULL,
	"target_team_id" text NOT NULL,
	"timestamp" text NOT NULL,
	"disputed" boolean NOT NULL,
	"voided" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"team_id" text NOT NULL,
	"token" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_log" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"timestamp" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_log_game_type_idx" ON "event_log" ("game_id", "type");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "photos" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"team_id" text NOT NULL,
	"landmark_id" text NOT NULL,
	"filename" text NOT NULL,
	"url" text NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"created_at" text NOT NULL
);
