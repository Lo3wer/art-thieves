import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from './schema-postgres';
import path from 'path';

let pool: Pool | null = null;
let ready: Promise<void> | null = null;

export function getPostgresDb(): NodePgDatabase<typeof schema> {
  if (!process.env.DATABASE_URL) throw new Error('DB_DRIVER=postgres requires DATABASE_URL');
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return drizzle(pool, { schema });
}

export function postgresReady(): Promise<void> {
  if (!ready) {
    const db = getPostgresDb();
    const migrationsFolder = process.env.POSTGRES_MIGRATIONS_DIR ?? path.join(process.cwd(), 'drizzle-postgres');
    ready = migrate(db, { migrationsFolder }).then(() => undefined);
  }
  return ready;
}

export async function closePostgresDb(): Promise<void> {
  if (pool) await pool.end();
  pool = null;
  ready = null;
}
