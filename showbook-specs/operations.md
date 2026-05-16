# Showbook — Operations

Operator runbook for the self-hosted prod stack: deploy, query the
database from another machine, and test isolation details. The
[root README](../README.md) covers what gets you to a running prod web
container; everything beyond that lives here.

## Stack layout (dev vs prod)

Both compose files bind to `127.0.0.1` only — Cloudflare Tunnel
(cloudflared) runs on the same host and reaches web via loopback. Dev
and prod coexist on different host ports so both stacks can run
simultaneously.

| Stack | Compose file | Project | Web port | DB port | DB name / role |
|-------|--------------|---------|----------|---------|----------------|
| dev   | `docker-compose.yml`      | `showbook-dev`  | `127.0.0.1:3001` | `127.0.0.1:5433` | `showbook` / `showbook` |
| prod  | `docker-compose.prod.yml` | `showbook-prod` | `127.0.0.1:3002` | `127.0.0.1:5434` | `showbook_prod` / `showbook_prod` |

Playwright's E2E dev server defaults to `3003` (override with
`PLAYWRIGHT_PORT`) so it doesn't fight with either stack. The
Cloudflare Tunnel ingress for the prod hostname must point at
`http://localhost:3002` — see
[`cloudflare-tunnel-setup.md`](cloudflare-tunnel-setup.md).

Postgres volumes are namespaced (`showbook_pgdata` vs
`showbook-prod_pgdata`), so dev and prod don't share data,
credentials, or a host port. The
[`scripts/guard-not-prod-db.mjs`](../scripts/guard-not-prod-db.mjs)
script refuses any dev/test workspace command whose `DATABASE_URL`
points at a `showbook_prod*` database.

## Continuous deployment

[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)
redeploys the prod box every time CI passes on `main`. It runs on a
**self-hosted GitHub Actions runner** installed on the prod machine,
fetches the deploy SHA into a fixed prod tree, and runs `pnpm prod:up
&& pnpm prod:db:migrate`. No inbound ports are required — the runner
connects out to GitHub, so this works behind Cloudflare Tunnel.

One-time setup on the prod host:

```bash
pnpm setup:runner
```

This clones the repo to `/opt/showbook` (override with `$PROD_DIR`),
downloads the GitHub Actions runner, registers it with the
`showbook-prod` label, writes a `.env` so the service can find docker /
pnpm / git, and installs it as a launchd (macOS) or systemd (Linux)
service. The script is idempotent — rerun it safely after upgrades.

After the script finishes, edit `/opt/showbook/.env.prod` with real
secrets (see the Environment Variables section of the root README), then
lock down fork PRs: under *Settings → Actions → General* set *Fork pull
request workflows from outside collaborators* to *Require approval for
all outside collaborators*.

After that, every push to `main` that turns CI green will redeploy. To
deploy a specific SHA on demand, use *Actions → Deploy (prod) → Run
workflow* and pass the SHA.

## Querying the prod database from another machine

Postgres is bound to `127.0.0.1:5434` on the prod host, so direct
connections require either an SSH tunnel (DBeaver / `psql`) or the
read-only HTTPS endpoint described here.

`POST /api/admin/sql` accepts a single `SELECT` / `EXPLAIN` / `WITH` /
`SHOW` / `TABLE` / `VALUES` statement, runs it inside a `BEGIN READ
ONLY` transaction with a 5s `statement_timeout`, and returns up to 1000
rows as JSON. Bearer-auth'd via `ADMIN_QUERY_TOKEN`. Disabled (401)
when the token is unset or shorter than 32 chars.

```bash
# One-time: generate the token and add to .env.prod, then restart prod web.
openssl rand -hex 32     # → ADMIN_QUERY_TOKEN=<value>
pnpm prod:up             # restart picks up the new env

# From a dev machine (or Claude Code on the web):
export ADMIN_QUERY_URL=https://<your-tunnel-hostname>
export ADMIN_QUERY_TOKEN=<value-from-.env.prod>
pnpm prod:query "select count(*) from shows"
pnpm prod:query --file query.sql
echo "select * from users limit 5" | pnpm prod:query
```

Writes are blocked at the Postgres engine — the `READ ONLY` transaction
errors any INSERT/UPDATE/DELETE/DDL with SQLSTATE `25006`.

### Restricting the endpoint to a dedicated read-only role (recommended)

By default, `/api/admin/sql` connects via `DATABASE_URL` — i.e. as the app's
main role, which owns the schema. The `BEGIN READ ONLY` transaction blocks
writes, but a privileged role can still SELECT `pg_read_file`, `pg_authid`, and
the NextAuth `accounts` / `sessions` / `verification_tokens` tables (which
hold OAuth refresh tokens and session material). If `ADMIN_QUERY_TOKEN`
leaks, that's an account-takeover-class incident.

Migration `0027_admin_query_role.sql` adds a dedicated `showbook_query` role
with SELECT on public tables only, with explicit REVOKE on the three auth
tables above. Wire the endpoint up to it as a one-time post-migration step:

```bash
# On the prod host, after `pnpm prod:db:migrate` has run 0027 (the role exists
# as NOLOGIN until you do this). Use a long random password — it never needs
# to be typed by a human, only loaded from .env.prod.
PASSWORD=$(openssl rand -hex 32)
docker compose -f docker-compose.prod.yml -p showbook-prod exec -T db \
  psql -U showbook_prod -d showbook_prod \
    -c "ALTER ROLE showbook_query WITH LOGIN PASSWORD '$PASSWORD'"

# Then add to .env.prod and restart:
echo "ADMIN_QUERY_DATABASE_URL=postgresql://showbook_query:$PASSWORD@db:5432/showbook_prod" >> .env.prod
pnpm prod:up
```

The endpoint prefers `ADMIN_QUERY_DATABASE_URL` when set and falls back to
`DATABASE_URL` otherwise, so this is a safe roll-forward — adopt it when
ready without breaking existing flows. Verify the lockdown is live:

```bash
pnpm prod:query "select 1 from accounts limit 1"
# expect: 500 server_error with details "permission denied for table accounts"
pnpm prod:query "select count(*) from users"
# expect: 200 with a row count
```

## E2E database isolation

Development data lives in the `showbook` database. Playwright tests use a
separate `showbook_e2e` database in the same Postgres container so
`/api/test/seed` can wipe and rebuild fixtures without touching local dev
data.

`pnpm test:e2e` runs `pnpm dev:db:prepare:e2e` first, then starts a
Playwright-owned Next.js dev server at `https://localhost:3003` (override
with `PLAYWRIGHT_PORT`) with:

```bash
DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook_e2e
ENABLE_TEST_ROUTES=1
NEXTAUTH_URL=https://localhost:3003
```

The `/api/test/*` routes are disabled unless `ENABLE_TEST_ROUTES=1` is set
and the active database name is `showbook_e2e`. Integration tests
(`pnpm test:integration`) share the same `showbook_e2e` database and use
the same guard.
