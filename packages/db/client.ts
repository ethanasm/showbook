import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL!;

// Cache the postgres client on globalThis so Next.js HMR module reloads
// don't accumulate orphaned connection pools (each pool would otherwise
// claim its `max` slots; without this we exhaust Postgres's default
// 100-conn limit after a handful of reloads). In production this just
// creates one pool.
const globalForDb = globalThis as unknown as {
  __showbookPg?: ReturnType<typeof postgres>;
};

// Pool sizing math (Postgres `max_connections` default = 100):
//   - this Drizzle pool, sized for HTTP + Drizzle-backed job handlers: 20
//   - pg-boss worker (separate PgBoss instance, default pool ~10):       10
//   - pg-boss send-only client (api/job-queue.ts, max: 2):                2
//   - operator headroom (drizzle-kit migrate, prod-query, psql):         ~5
// Total ≈ 37 slots per web container, leaving ~60 for the host + admin.
// Bumped from 10 → 20 so a job handler holding a long-running connection
// (e.g. a nightly digest issuing per-user SELECTs) can't starve concurrent
// HTTP requests of pooled connections.
const client =
  globalForDb.__showbookPg ??
  postgres(connectionString, { max: 20, idle_timeout: 20 });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__showbookPg = client;
}

export const db = drizzle(client, { schema });
export type Database = typeof db;
