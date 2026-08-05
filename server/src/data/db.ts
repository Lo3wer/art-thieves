import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'data', 'vat.db');
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? path.join(process.cwd(), 'drizzle');

let dbInstance: BetterSQLite3Database<typeof schema> | null = null;

export function getDbPath(): string {
  return DB_PATH;
}

export function initDb(): BetterSQLite3Database<typeof schema> {
  if (dbInstance) return dbInstance;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  dbInstance = drizzle(sqlite, { schema });
  migrate(dbInstance, { migrationsFolder: MIGRATIONS_DIR });
  return dbInstance;
}

export function getDb(): BetterSQLite3Database<typeof schema> {
  return initDb();
}

export type Db = BetterSQLite3Database<typeof schema>;
export type { BetterSQLite3Database };
