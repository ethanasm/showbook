# Postgres backups

One-page operator runbook for the prod Showbook database. Keep
backups simple: nightly logical dump on the host, off-box copy to a
durable object store, monthly restore test.

## Targets

- **RPO (Recovery Point Objective):** ≤ 24 h. Logical nightly dumps —
  worst case the user loses a day of mutations. Worth it for the
  simplicity vs. WAL streaming.
- **RTO (Recovery Time Objective):** ≤ 1 h. The prod DB is small
  (low single-digit GB), so a fresh container + `pg_restore` finishes
  in minutes. Most of the hour is operator overhead (env restore,
  tunnel restart, smoke check).
- **Retention:** 30 days local + 30 days remote. Older dumps roll
  off automatically.

## Schedule

Host-side cron, not pg-boss. `pg-boss` runs inside the same Postgres
we're backing up, so if the DB is unreachable the backup job can't
fire either — defeating the point. Use the host's `cron` (or
systemd-timer) instead.

```cron
# /etc/cron.d/showbook-backup
# Nightly Postgres dump at 02:30 local time.
30 2 * * * showbook-ops bash -c 'node /home/showbook-ops/showbook/scripts/backup-postgres.mjs >> /var/log/showbook-backup.log 2>&1'
```

## What the script does

`scripts/backup-postgres.mjs`:

1. Runs `pg_dump --format=custom --no-owner --no-acl` against the
   prod database via `DATABASE_URL` from the operator's `.env.prod`.
2. Writes to `/var/backups/showbook/showbook-prod-<UTC date>.dump`.
3. Compresses with `gzip` (custom format is already compressed, so
   this is belt-and-suspenders).
4. Optionally calls `rclone copyto <local> <remote>:showbook-backups/<name>` if `RCLONE_REMOTE` is set.
5. Prunes local + remote dumps older than 30 days.
6. Exits non-zero on any failure so cron mails the operator.

## Restore (drill quarterly)

```bash
# 1. Spin up a fresh staging DB (or reuse $STAGING_DATABASE_URL).
docker run --rm -d --name showbook-restore-staging \
  -e POSTGRES_PASSWORD=staging -e POSTGRES_DB=showbook_restore \
  -p 5435:5432 postgres:16-alpine

# 2. Wait for it.
until pg_isready -h 127.0.0.1 -p 5435 -U postgres; do sleep 1; done

# 3. Restore the latest dump.
LATEST=$(ls -t /var/backups/showbook/*.dump.gz | head -1)
gunzip -c "$LATEST" | pg_restore --no-owner --no-acl \
  -h 127.0.0.1 -p 5435 -U postgres -d showbook_restore

# 4. Sanity-check row counts vs. prod.
psql -h 127.0.0.1 -p 5435 -U postgres -d showbook_restore \
  -c 'SELECT count(*) FROM users; SELECT count(*) FROM shows;'

# 5. Tear down.
docker rm -f showbook-restore-staging
```

If row counts diverge by more than expected diff-since-dump, treat
the dump as compromised and re-run from the most recent durable copy.

## Monthly checklist

1. Verify cron last ran successfully:
   `sudo tail -50 /var/log/showbook-backup.log`.
2. Confirm a dump landed in `/var/backups/showbook/` and the remote
   target last night.
3. Run the restore drill above against the most recent dump.
4. Record completion in `docs/specs/operations/backup-log.md` (one line:
   date + tester + outcome).

## What's intentionally not done

- **WAL streaming / point-in-time recovery.** Adds operational
  complexity (archive command, base backup hygiene, restore-window
  testing) for a 24 h → < 1 h RPO improvement we don't yet need.
  Revisit when the DB has paying users.
- **In-Postgres backup jobs.** See the cron rationale above.
- **Encrypted at-rest dumps.** The remote target is responsible for
  at-rest encryption (S3 SSE-S3 / B2 native). The local `/var/backups`
  directory should be mode 0700 owned by the backup user.
