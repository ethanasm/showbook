---
name: debugging-prod
description: Use when investigating production issues in the showbook stack — errors in prod, failed pg-boss jobs, regressions only seen in prod, missing daily digest, "is X working in prod", or "prod is broken" reports. Covers Axiom log queries via APL, the read-only `/api/admin/sql` endpoint for prod DB introspection, and the docker logs fallback.
---

# Debugging prod

## Overview

Prod observability has two read paths:

- **Logs** ship from `showbook-prod-web` to Axiom (dataset `showbook-prod`) via `pino` + `@axiomhq/pino`. The repo-side `AXIOM_TOKEN` is **ingest-only** and cannot read. Querying requires a user-scoped Personal Access Token (PAT) with the `Query` capability on the `showbook-prod` dataset, exposed to the shell as `AXIOM_QUERY_TOKEN`.
- **Database state** is reachable read-only via `POST /api/admin/sql` (bearer-auth'd by `ADMIN_QUERY_TOKEN`). The endpoint wraps every query in a `BEGIN READ ONLY` transaction so writes are blocked at the engine, with a 5s statement timeout and a 1000-row cap. Use it for "is the row there", schema lookups, recent-activity counts — the kind of one-off SELECTs that used to require an SSH tunnel.

The runbook below turns a vague prod report into the next concrete query. CLAUDE.md is the source of truth for the curated event-name catalog, organized by component prefix — refer to it when narrowing by `event`.

## When to use

- A user reports something broken in prod
- A pg-boss job is suspected to have failed (digest not sent, backfill skipped, etc.)
- An error log surfaced and you need surrounding context
- You need to confirm whether an event fired today (e.g. `notifications.digest.summary`)

## When NOT to use

- **LLM regressions** (bad output, slow generations, missing tool calls) → Langfuse, not Axiom. Traces from `traceLLM` / `withTrace` are not in this dataset.
- **Local/dev debugging** → `AXIOM_TOKEN` is intentionally unset in `.env.dev`; just read stdout.
- **Migration issues** → check `pnpm prod:migrate` output. (Schema *introspection* is fine via `/api/admin/sql` — see below — but applying migrations isn't.)
- **Cloud / web-sandbox sessions, Axiom queries only** — the Axiom recipes rely on `AXIOM_QUERY_TOKEN` exported into the shell, which isn't pre-populated in cloud envs. Ask the user to paste the token (or run the Axiom recipes locally and share the output). The DB recipes (`/api/admin/sql`) DO work from cloud sandboxes since they go through public HTTPS — just have the user paste `ADMIN_QUERY_TOKEN` and `ADMIN_QUERY_URL` into the session env.

## Pre-flight

The token must be available as an env var. Different environments expose it
differently — check, and if missing, source the user's shell rc as a fallback:

```bash
if [ -z "$AXIOM_QUERY_TOKEN" ] && [ -f ~/.zshrc ]; then . ~/.zshrc; fi
if [ -z "$AXIOM_QUERY_TOKEN" ] && [ -f ~/.bashrc ]; then . ~/.bashrc; fi
test -n "$AXIOM_QUERY_TOKEN" && echo "ok" || echo "AXIOM_QUERY_TOKEN missing — ask the user to export a PAT from Axiom → Settings → Profile → Personal Access Tokens"
```

If still unset, ask the user to export it. Never commit it.

The Axiom org id is **autodiscovered** from the token — no hardcoded slug. The query template below resolves it once via `/v1/orgs` and caches it in `$AXIOM_ORG`. (If `$AXIOM_ORG` is already exported, it's used as-is. The env var `AXIOM_ORG_ID` is sometimes confused with the dataset name; do not rely on it.)

## Decision tree

```
Symptom from user
        │
        ├── "prod is broken" / vague
        │       └─→ recent warn+error query (last 1h)
        │
        ├── specific feature regression (auth, venue follow, digest, …)
        │       └─→ filter by matching event prefix from CLAUDE.md catalog
        │
        ├── pg-boss job failed / didn't run
        │       └─→ filter event == "job.failed" OR job == "<name>", inspect jobId
        │
        ├── "is row X actually there in prod" / "what does prod's state look like"
        │       └─→ /api/admin/sql via `pnpm prod:query` (read-only)
        │
        ├── LLM call quality issue (bad output, hallucination, slow)
        │       └─→ STOP — Langfuse, not Axiom
        │
        └── Axiom returns nothing relevant
                └─→ docker logs fallback (recent only; container stdout is captured)
```

## Query template

All queries use the same curl wrapper. Substitute the APL string in `<<APL>>`.
The preamble auto-discovers `$AXIOM_ORG` if not already set, so the wrapper
works on any machine that has `AXIOM_QUERY_TOKEN` exported (laptop, server,
sandbox):

```bash
: "${AXIOM_ORG:=$(curl -sS https://api.axiom.co/v1/orgs -H "Authorization: Bearer $AXIOM_QUERY_TOKEN" | python3 -c 'import sys,json; print(json.load(sys.stdin)[0]["id"])')}"
curl -sS -X POST "https://api.axiom.co/v1/datasets/_apl?format=tabular" \
  -H "Authorization: Bearer $AXIOM_QUERY_TOKEN" \
  -H "X-AXIOM-ORG-ID: $AXIOM_ORG" \
  -H "Content-Type: application/json" \
  -d '{"apl": "<<APL>>"}'
```

Pipe to `python3 -m json.tool` (or `jq`) for readability. For row-oriented
output from the tabular response, this one-liner zips the column arrays back
into per-row JSON:

```bash
python3 -c "import sys,json; d=json.load(sys.stdin); t=d['tables'][0]; f=[x['name'] for x in t['fields']]; [print(json.dumps(dict(zip(f,r)))) for r in zip(*t['columns'])]"
```

## Recipe library

Drop these into the `<<APL>>` slot above.

**1. Recent warn+error (last hour) — start here for vague reports.**
```
["showbook-prod"] | where _time > ago(1h) and level in ("warn","error") | project _time, level, event, component, msg | order by _time desc | limit 100
```

**2. Filter by event prefix — when you know the affected feature.**
```
["showbook-prod"] | where _time > ago(2h) and event startswith "venue.follow" | project _time, level, event, msg, userId | order by _time desc
```
(See CLAUDE.md "Structured event names" for the prefix catalog: `auth.*`, `tm.*`, `setlistfm.*`, `venue_matcher.*`, `geocode.*`, `performer.*`, `discover.ingest.*`, `notifications.digest.*`, `pgboss.*`, `job.*`, `trpc.*`, etc.)

**3. Single job run by jobId — full lifecycle for one execution.**
```
["showbook-prod"] | where _time > ago(24h) and jobId == "<JOB_ID>" | project _time, level, event, job, msg | order by _time asc
```

**4. Failed jobs in last 24h — what blew up overnight.**
```
["showbook-prod"] | where _time > ago(24h) and event == "job.failed" | project _time, job, jobId, msg | order by _time desc
```

**5. Did event X fire today? — confirm a scheduled run.**
```
["showbook-prod"] | where _time > ago(24h) and event == "notifications.digest.summary" | project _time, msg | order by _time desc
```

**6. Top events by volume (last 24h) — for spotting noisy or missing components.**
```
["showbook-prod"] | where _time > ago(24h) | summarize n=count() by event | order by n desc | limit 30
```

**7. Errors with full context (last 6h).**
```
["showbook-prod"] | where _time > ago(6h) and level == "error" | project _time, event, component, msg, ["err.message"], ["err.cause.message"] | order by _time desc | limit 50
```

Note: nested error fields are flattened by Axiom's ingest into dotted columns
(`err.message`, `err.cause.message`, etc.). Reference them with bracket-quoted
identifiers in APL — bare `err` will fail to compile.

## DB introspection — `/api/admin/sql`

When the question is "what is the prod DB's *state*" rather than "what did the app *log*", use the read-only SQL endpoint. Bearer-auth'd, READ ONLY transaction, 5s statement timeout, 1000-row cap.

### Pre-flight (DB)

```bash
if [ -z "$ADMIN_QUERY_TOKEN" ] && [ -f ~/.zshrc ]; then . ~/.zshrc; fi
if [ -z "$ADMIN_QUERY_TOKEN" ] && [ -f ~/.bashrc ]; then . ~/.bashrc; fi
test -n "$ADMIN_QUERY_TOKEN" && test -n "$ADMIN_QUERY_URL" && echo "ok" || echo "missing — ask the user to export ADMIN_QUERY_TOKEN (matches .env.prod) and ADMIN_QUERY_URL (https://<prod-host>)"
```

`ADMIN_QUERY_URL` is the prod base URL (e.g. the Cloudflare Tunnel hostname). `ADMIN_QUERY_TOKEN` must match the value in the prod host's `.env.prod`. In a cloud sandbox the user has to paste both into the session env.

### Invocation

The `pnpm prod:query` script wraps the curl call and pretty-prints rows as TSV with a row-count footer. It accepts the query as a positional arg, via `--file <path>`, or on stdin:

```bash
pnpm prod:query "select count(*) from shows where created_at > now() - interval '24 hours'"
pnpm prod:query --file /tmp/q.sql
echo "select id, name from venues where city = 'Brooklyn' limit 10" | pnpm prod:query
```

Direct curl works too if you want raw JSON (e.g. to pipe into `jq`):

```bash
curl -sS -X POST "$ADMIN_QUERY_URL/api/admin/sql" \
  -H "Authorization: Bearer $ADMIN_QUERY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"select level, count(*) from pgboss.archive group by level"}' | jq .
```

### Recipe library (DB)

**A. Confirm a row landed.**
```sql
SELECT id, status, created_at FROM shows WHERE id = '<id>';
```

**B. Recent activity in a table.**
```sql
SELECT count(*), max(created_at) FROM shows WHERE created_at > now() - interval '24 hours';
```

**C. pg-boss queue depth — what's pending or failing.**
```sql
SELECT name, state, count(*) FROM pgboss.job
WHERE created_on > now() - interval '24 hours'
GROUP BY name, state
ORDER BY name, state;
```

**D. Last failed job per name.**
```sql
SELECT name, max(completed_on) AS last_fail, count(*) AS fails
FROM pgboss.job
WHERE state = 'failed' AND completed_on > now() - interval '24 hours'
GROUP BY name ORDER BY last_fail DESC;
```

**E. Schema spot-check.**
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'shows' ORDER BY ordinal_position;
```

**F. Did the daily digest run today (DB-side complement to the `notifications.digest.summary` log event).**
```sql
SELECT name, completed_on, state FROM pgboss.job
WHERE name = 'daily-digest' AND completed_on > now() - interval '36 hours'
ORDER BY completed_on DESC LIMIT 5;
```

### What the endpoint refuses

The endpoint returns 422 `query_rejected` for:
- Non-allowlisted verbs (anything other than `SELECT`/`EXPLAIN`/`WITH`/`SHOW`/`TABLE`/`VALUES`).
- Multiple statements (`SELECT 1; SELECT 2`).
- INSERT/UPDATE/DELETE/DDL — caught by the `BEGIN READ ONLY` transaction at the engine, SQLSTATE `25006`.

A 504 means the query exceeded `statement_timeout` (5s). Rewrite with a `LIMIT`, an indexed `WHERE`, or an `EXPLAIN` first.

A 401 means the token is wrong, missing, or shorter than 32 chars on the server (the endpoint refuses to enable itself for a weak token).

## Docker logs fallback

When Axiom returns nothing for a recent window (retention rolled off, ingest lag, or the container restarted before flushing), fall through to the container's stdout — only useful when SSH'd to the host running prod:

```bash
docker logs showbook-prod-web --since 15m 2>&1 | tail -200
docker logs showbook-prod-web --since 1h 2>&1 | grep -E '"level":"(warn|error)"'
```

Stdout is JSON (`pino` in prod), so `jq` works:

```bash
docker logs showbook-prod-web --since 30m 2>&1 | jq -c 'select(.level=="error") | {time, event, msg, err}'
```

## Pitfalls

- **`err.cause` is missing in Axiom.** Pino's `err` serializer in `packages/observability/src/logger.ts` does NOT walk `cause`, so wrapped postgres-js / Drizzle errors lose their underlying SQLSTATE. If a `Failed query: …` log is unhelpful, fix the serializer first rather than working around it. Docker stdout has the same gap — it's the serializer, not the transport.
- **Wrong token = empty results, not auth error.** `AXIOM_TOKEN` is ingest-only. If `AXIOM_QUERY_TOKEN` was created without `Query` capability on `showbook-prod`, Axiom returns 200 with no rows. Verify in the UI under Settings → Tokens.
- **Org id ≠ dataset name.** The dataset is `showbook-prod`; the org slug is something else (e.g. `showbook-egap`). Do not hardcode it — let the `/v1/orgs` lookup resolve it. Setting `AXIOM_ORG_ID=showbook-prod` (the dataset) makes every query 404.
- **Org header is required for query requests.** Omitting `X-AXIOM-ORG-ID` on `/v1/datasets/_apl` gives a 400; pointing it at the wrong org gives a 404 with empty body (not a clear auth error).
- **Timezone.** `_time` is UTC. Convert with `bin_auto(_time)` and `format_datetime(_time, "yyyy-MM-dd HH:mm:ss")` if comparing against ET-scheduled jobs (digest at 08:00 ET = 12:00/13:00 UTC depending on DST).

## Quick reference

| Task | Where |
|------|-------|
| App / job logs | Axiom `showbook-prod` (this skill) |
| LLM traces | Langfuse |
| Prod DB state (read-only) | `pnpm prod:query "..."` → `/api/admin/sql` |
| Migration output | `pnpm prod:migrate` |
| Container health | `docker ps`, `docker logs showbook-prod-web` |
| Event-name catalog | `CLAUDE.md` → "Structured event names worth knowing" |
