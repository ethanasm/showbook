-- Read-only Postgres role for the /api/admin/sql endpoint.
--
-- Why this exists: a `BEGIN READ ONLY` transaction blocks INSERT/UPDATE/DELETE
-- and DDL, but it does NOT block SELECT-shaped exfiltration (pg_read_file,
-- pg_authid, dblink to a fresh non-readonly connection, etc.) when the
-- connecting role is privileged. The /api/admin/sql endpoint historically used
-- the app's main DATABASE_URL, which connects as a role that owns the schema.
-- A leak of `ADMIN_QUERY_TOKEN` was therefore worst-case "full DB read +
-- file-system access via privileged catalog functions."
--
-- This role is the defense-in-depth fix: a dedicated login role with SELECT on
-- public tables and explicit REVOKE on the auth tables that hold session /
-- refresh-token material. The route should connect via ADMIN_QUERY_DATABASE_URL
-- pointing at this role; the engine then enforces the read-only contract even
-- before the BEGIN READ ONLY wrapper kicks in.
--
-- The role is created NOLOGIN here because drizzle-kit migrations don't have a
-- safe way to interpolate a password from the operator's secret store. After
-- this migration runs, the operator does a one-time `ALTER ROLE showbook_query
-- WITH LOGIN PASSWORD '<random>'` and then sets ADMIN_QUERY_DATABASE_URL in
-- .env.prod. Until that's done, the role exists but cannot connect — so the
-- endpoint falls back to its current behaviour (DATABASE_URL) without breaking.
-- See README.md → "Production deployment" for the exact steps.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'showbook_query') THEN
    CREATE ROLE showbook_query NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO showbook_query;
--> statement-breakpoint

GRANT SELECT ON ALL TABLES IN SCHEMA public TO showbook_query;
--> statement-breakpoint

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO showbook_query;
--> statement-breakpoint

-- Sensitive auth surfaces. NextAuth `accounts` carries OAuth refresh +
-- access tokens; `sessions` carries live session tokens; `verification_tokens`
-- carries email-verification one-time tokens. Any of these in attacker hands
-- is account takeover — keep them off the read-only role.
REVOKE ALL ON accounts FROM showbook_query;
--> statement-breakpoint
REVOKE ALL ON sessions FROM showbook_query;
--> statement-breakpoint
REVOKE ALL ON verification_tokens FROM showbook_query;
