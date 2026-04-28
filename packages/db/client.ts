import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL!;

// Cache the postgres client on globalThis so Next.js HMR module reloads
// don't accumulate orphaned connection pools (each pool defaults to 10
// connections; without this we exhaust Postgres's default 100-conn limit
// after ~10 reloads). In production this just creates one pool.
const globalForDb = globalThis as unknown as {
  __showbookPg?: ReturnType<typeof postgres>;
};

const client =
  globalForDb.__showbookPg ??
  postgres(connectionString, { max: 10, idle_timeout: 20 });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__showbookPg = client;
}

export const db = drizzle(client, { schema });
export type Database = typeof db;
