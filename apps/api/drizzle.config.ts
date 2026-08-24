import { defineConfig } from 'drizzle-kit';
import { getEnv } from './src/env';

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  casing: 'snake_case',
  dbCredentials: { url: getEnv().DATABASE_URL },
});
