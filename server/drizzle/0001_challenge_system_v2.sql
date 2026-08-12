-- Add structured challenge spec to landmarks
ALTER TABLE `landmarks` ADD COLUMN `challenge` text;
--> statement-breakpoint
-- Rebuild challenge_attempts with session columns (status/readyAt/completedAt/penaltyUntil)
CREATE TABLE `challenge_attempts_new` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`landmark_id` text NOT NULL,
	`team_id` text NOT NULL,
	`status` text NOT NULL DEFAULT 'ready',
	`outcome` text,
	`started_at` text NOT NULL,
	`ready_at` text,
	`completed_at` text,
	`penalty_until` text
);
--> statement-breakpoint
INSERT INTO `challenge_attempts_new` (`id`, `game_id`, `landmark_id`, `team_id`, `status`, `outcome`, `started_at`, `ready_at`, `completed_at`, `penalty_until`)
SELECT
  `id`,
  `game_id`,
  `landmark_id`,
  `team_id`,
  CASE WHEN `outcome` IS NOT NULL THEN `outcome` ELSE 'ready' END,
  `outcome`,
  `created_at`,
  NULL,
  CASE WHEN `outcome` IS NOT NULL THEN `created_at` ELSE NULL END,
  NULL
FROM `challenge_attempts`;
--> statement-breakpoint
DROP TABLE `challenge_attempts`;
--> statement-breakpoint
ALTER TABLE `challenge_attempts_new` RENAME TO `challenge_attempts`;
--> statement-breakpoint
CREATE TABLE `penalties` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`team_id` text NOT NULL,
	`type` text NOT NULL,
	`until` text NOT NULL
);