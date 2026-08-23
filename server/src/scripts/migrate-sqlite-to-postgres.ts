import 'dotenv/config';
import Database from 'better-sqlite3';
import { Pool } from 'pg';
import { postgresReady } from '../data/db-postgres';

const SQLITE_PATH = process.env.DATABASE_PATH ?? './data/vat.db';
const JSON_COLUMNS = new Set(['data', 'config', 'challenge']);
const BOOLEAN_COLUMNS = new Set(['locked', 'disputed', 'voided']);

const TABLES: Record<string, string[]> = {
  maps: ['id', 'name', 'center_lat', 'center_lng', 'default_zoom', 'default_vicinity_radius', 'win_threshold', 'data', 'created_at'],
  games: ['id', 'join_code', 'map_id', 'status', 'config', 'started_at', 'paused_at', 'total_paused_ms', 'host_team_id', 'created_at'],
  teams: ['id', 'game_id', 'name', 'color'],
  landmarks: ['id', 'game_id', 'name', 'latitude', 'longitude', 'image_url', 'challenge_text', 'challenge', 'map_landmark_index'],
  landmark_state: ['id', 'game_id', 'landmark_id', 'team_id', 'locked', 'claimed_at', 'claim_photo_id'],
  challenge_attempts: ['id', 'game_id', 'landmark_id', 'team_id', 'status', 'outcome', 'started_at', 'ready_at', 'completed_at', 'penalty_until'],
  penalties: ['id', 'game_id', 'team_id', 'type', 'until'],
  location_pings: ['id', 'game_id', 'team_id', 'latitude', 'longitude', 'timestamp'],
  tag_events: ['id', 'game_id', 'tagger_team_id', 'target_team_id', 'timestamp', 'disputed', 'voided'],
  push_tokens: ['id', 'game_id', 'team_id', 'token'],
  event_log: ['id', 'game_id', 'type', 'data', 'timestamp'],
  photos: ['id', 'game_id', 'team_id', 'landmark_id', 'filename', 'url', 'latitude', 'longitude', 'created_at'],
};

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function convertValue(column: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (JSON_COLUMNS.has(column) && typeof value === 'string') return JSON.parse(value);
  if (BOOLEAN_COLUMNS.has(column)) return Boolean(value);
  return value;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  await postgresReady();

  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  let copied = 0;

  try {
    await client.query('BEGIN');
    for (const [table, columns] of Object.entries(TABLES)) {
      const rows = sqlite.prepare(`SELECT ${columns.map(quoteIdentifier).join(', ')} FROM ${quoteIdentifier(table)}`).all() as Record<string, unknown>[];
      if (rows.length === 0) continue;
      const columnList = columns.map(quoteIdentifier).join(', ');
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
      const query = `INSERT INTO ${quoteIdentifier(table)} (${columnList}) VALUES (${placeholders}) ON CONFLICT ("id") DO NOTHING`;
      for (const row of rows) {
        await client.query(query, columns.map((column) => convertValue(column, row[column])));
        copied++;
      }
      console.log(`Migrated ${rows.length} row(s) from ${table}`);
    }
    await client.query('COMMIT');
    console.log(`Migration complete: ${copied} row(s) copied.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    sqlite.close();
    client.release();
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
