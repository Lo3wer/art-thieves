import { boolean, doublePrecision, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

export const maps = pgTable('maps', {
  id: text('id').primaryKey(), name: text('name').notNull(), centerLat: doublePrecision('center_lat').notNull(),
  centerLng: doublePrecision('center_lng').notNull(), defaultZoom: integer('default_zoom').notNull(),
  defaultVicinityRadius: integer('default_vicinity_radius').notNull(), winThreshold: integer('win_threshold').notNull(),
  data: jsonb('data').notNull(), createdAt: text('created_at').notNull(),
});
export const games = pgTable('games', {
  id: text('id').primaryKey(), joinCode: text('join_code').notNull().unique(), mapId: text('map_id').notNull(),
  status: text('status').notNull(), config: jsonb('config').notNull(), startedAt: text('started_at'), pausedAt: text('paused_at'),
  totalPausedMs: integer('total_paused_ms').notNull(), hostTeamId: text('host_team_id'), createdAt: text('created_at').notNull(),
});
export const teams = pgTable('teams', { id: text('id').primaryKey(), gameId: text('game_id').notNull(), name: text('name').notNull(), color: text('color').notNull() });
export const landmarks = pgTable('landmarks', {
  id: text('id').primaryKey(), gameId: text('game_id').notNull(), name: text('name').notNull(), latitude: doublePrecision('latitude').notNull(), longitude: doublePrecision('longitude').notNull(),
  imageUrl: text('image_url'), challengeText: text('challenge_text'), challenge: jsonb('challenge'), mapLandmarkIndex: integer('map_landmark_index').notNull(),
});
export const landmarkStates = pgTable('landmark_state', {
  id: text('id').primaryKey(), gameId: text('game_id').notNull(), landmarkId: text('landmark_id').notNull(), teamId: text('team_id'), locked: boolean('locked').notNull(), claimedAt: text('claimed_at'), claimPhotoId: text('claim_photo_id'),
}, (table) => [uniqueIndex('landmark_state_game_landmark_idx').on(table.gameId, table.landmarkId)]);
export const challengeAttempts = pgTable('challenge_attempts', {
  id: text('id').primaryKey(), gameId: text('game_id').notNull(), landmarkId: text('landmark_id').notNull(), teamId: text('team_id').notNull(), status: text('status').notNull(), outcome: text('outcome'), startedAt: text('started_at').notNull(), readyAt: text('ready_at'), completedAt: text('completed_at'), penaltyUntil: text('penalty_until'),
});
export const penalties = pgTable('penalties', { id: text('id').primaryKey(), gameId: text('game_id').notNull(), teamId: text('team_id').notNull(), type: text('type').notNull(), until: text('until').notNull() });
export const locationPings = pgTable('location_pings', {
  id: text('id').primaryKey(), gameId: text('game_id').notNull(), teamId: text('team_id').notNull(), latitude: doublePrecision('latitude').notNull(), longitude: doublePrecision('longitude').notNull(), timestamp: text('timestamp').notNull(),
}, (table) => [index('location_pings_game_timestamp_idx').on(table.gameId, table.timestamp)]);
export const tagEvents = pgTable('tag_events', { id: text('id').primaryKey(), gameId: text('game_id').notNull(), taggerTeamId: text('tagger_team_id').notNull(), targetTeamId: text('target_team_id').notNull(), timestamp: text('timestamp').notNull(), disputed: boolean('disputed').notNull(), voided: boolean('voided').notNull() });
export const pushTokens = pgTable('push_tokens', { id: text('id').primaryKey(), gameId: text('game_id').notNull(), teamId: text('team_id').notNull(), token: text('token').notNull() });
export const eventLog = pgTable('event_log', { id: text('id').primaryKey(), gameId: text('game_id').notNull(), type: text('type').notNull(), data: jsonb('data').notNull(), timestamp: text('timestamp').notNull() }, (table) => [index('event_log_game_type_idx').on(table.gameId, table.type)]);
export const photos = pgTable('photos', { id: text('id').primaryKey(), gameId: text('game_id').notNull(), teamId: text('team_id').notNull(), landmarkId: text('landmark_id').notNull(), filename: text('filename').notNull(), url: text('url').notNull(), latitude: doublePrecision('latitude'), longitude: doublePrecision('longitude'), createdAt: text('created_at').notNull() });

export const postgresSchema = { maps, games, teams, landmarks, landmarkStates, challengeAttempts, penalties, locationPings, tagEvents, pushTokens, eventLog, photos };
