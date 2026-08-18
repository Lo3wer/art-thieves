import { sqliteTable, text, real, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

export const maps = sqliteTable('maps', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  centerLat: real('center_lat').notNull(),
  centerLng: real('center_lng').notNull(),
  defaultZoom: integer('default_zoom').notNull(),
  defaultVicinityRadius: integer('default_vicinity_radius').notNull(),
  winThreshold: integer('win_threshold').notNull(),
  data: text('data', { mode: 'json' }).notNull(),
  createdAt: text('created_at').notNull(),
});

export const games = sqliteTable('games', {
  id: text('id').primaryKey(),
  joinCode: text('join_code').notNull().unique(),
  mapId: text('map_id').notNull(),
  status: text('status').notNull(),
  config: text('config', { mode: 'json' }).notNull(),
  startedAt: text('started_at'),
  pausedAt: text('paused_at'),
  totalPausedMs: integer('total_paused_ms').notNull(),
  hostTeamId: text('host_team_id'),
  createdAt: text('created_at').notNull(),
});

export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(),
  gameId: text('game_id').notNull(),
  name: text('name').notNull(),
  color: text('color').notNull(),
});

export const landmarks = sqliteTable('landmarks', {
  id: text('id').primaryKey(),
  gameId: text('game_id').notNull(),
  name: text('name').notNull(),
  latitude: real('latitude').notNull(),
  longitude: real('longitude').notNull(),
  imageUrl: text('image_url'),
  challengeText: text('challenge_text'),
  challenge: text('challenge', { mode: 'json' }),
  mapLandmarkIndex: integer('map_landmark_index').notNull(),
});

export const landmarkStates = sqliteTable(
  'landmark_state',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id').notNull(),
    landmarkId: text('landmark_id').notNull(),
    teamId: text('team_id'),
    locked: integer('locked', { mode: 'boolean' }).notNull(),
    claimedAt: text('claimed_at'),
    claimPhotoId: text('claim_photo_id'),
  },
  (table) => [uniqueIndex('landmark_state_game_landmark_idx').on(table.gameId, table.landmarkId)]
);

export const challengeAttempts = sqliteTable('challenge_attempts', {
  id: text('id').primaryKey(),
  gameId: text('game_id').notNull(),
  landmarkId: text('landmark_id').notNull(),
  teamId: text('team_id').notNull(),
  status: text('status').notNull(),
  outcome: text('outcome'),
  startedAt: text('started_at').notNull(),
  readyAt: text('ready_at'),
  completedAt: text('completed_at'),
  penaltyUntil: text('penalty_until'),
});

export const penalties = sqliteTable('penalties', {
  id: text('id').primaryKey(),
  gameId: text('game_id').notNull(),
  teamId: text('team_id').notNull(),
  type: text('type').notNull(),
  until: text('until').notNull(),
});

export const locationPings = sqliteTable(
  'location_pings',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id').notNull(),
    teamId: text('team_id').notNull(),
    latitude: real('latitude').notNull(),
    longitude: real('longitude').notNull(),
    timestamp: text('timestamp').notNull(),
  },
  (table) => [index('location_pings_game_timestamp_idx').on(table.gameId, table.timestamp)]
);

export const tagEvents = sqliteTable('tag_events', {
  id: text('id').primaryKey(),
  gameId: text('game_id').notNull(),
  taggerTeamId: text('tagger_team_id').notNull(),
  targetTeamId: text('target_team_id').notNull(),
  timestamp: text('timestamp').notNull(),
  disputed: integer('disputed', { mode: 'boolean' }).notNull(),
  voided: integer('voided', { mode: 'boolean' }).notNull(),
});

export const pushTokens = sqliteTable('push_tokens', {
  id: text('id').primaryKey(),
  gameId: text('game_id').notNull(),
  teamId: text('team_id').notNull(),
  token: text('token').notNull(),
});

export const eventLog = sqliteTable(
  'event_log',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id').notNull(),
    type: text('type').notNull(),
    data: text('data', { mode: 'json' }).notNull(),
    timestamp: text('timestamp').notNull(),
  },
  (table) => [index('event_log_game_type_idx').on(table.gameId, table.type)]
);

export const photos = sqliteTable('photos', {
  id: text('id').primaryKey(),
  gameId: text('game_id').notNull(),
  teamId: text('team_id').notNull(),
  landmarkId: text('landmark_id').notNull(),
  filename: text('filename').notNull(),
  url: text('url').notNull(),
  latitude: real('latitude'),
  longitude: real('longitude'),
  createdAt: text('created_at').notNull(),
});
