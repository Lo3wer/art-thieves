import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'data', 'vat.db');
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? path.join(process.cwd(), 'drizzle');

let dbInstance: BetterSQLite3Database<typeof schema> | null = null;
let uploadsPath: string | null = null;

export function isPersistent(): boolean {
  const driver = process.env.DB_DRIVER?.toLowerCase();
  if (driver === 'memory') return false;
  if (driver === 'sqlite' || driver === 'postgres') return true;
  if (process.env.DB_IN_MEMORY === '1') return false;
  return (process.env.PERSIST ?? 'true').toLowerCase() !== 'false';
}

export function getUploadsDir(): string {
  if (!uploadsPath) {
    uploadsPath = isPersistent()
      ? process.env.UPLOADS_DIR ?? path.join(process.cwd(), 'uploads')
      : fs.mkdtempSync(path.join(os.tmpdir(), 'vat-uploads-'));
  }
  return uploadsPath;
}

export function getDbPath(): string {
  return DB_PATH;
}

export function initDb(): BetterSQLite3Database<typeof schema> {
  if (dbInstance) return dbInstance;
  if ((process.env.DB_DRIVER ?? 'sqlite').toLowerCase() === 'postgres') {
    throw new Error('initDb() is only available for SQLite; use initializeDatabase() for PostgreSQL');
  }
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  dbInstance = drizzle(sqlite, { schema });
  migrate(dbInstance, { migrationsFolder: MIGRATIONS_DIR });
  return dbInstance;
}

export async function initializeDatabase(): Promise<void> {
  if (!isPersistent()) return;
  if ((process.env.DB_DRIVER ?? 'sqlite').toLowerCase() === 'postgres') {
    const { postgresReady } = await import('./db-postgres');
    await postgresReady();
    const { seedPostgresMaps } = await import('./store-postgres');
    await seedPostgresMaps();
    return;
  }
  initDb();
}

export function getDb(): BetterSQLite3Database<typeof schema> {
  return initDb();
}

export function closeDb(): void {
  if (!dbInstance) return;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  (dbInstance as any).$client?.close?.();
  dbInstance = null;
}

export type Db = BetterSQLite3Database<typeof schema>;
export type { BetterSQLite3Database };
