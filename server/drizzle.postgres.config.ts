import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/data/schema-postgres.ts',
  out: './drizzle-postgres',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
