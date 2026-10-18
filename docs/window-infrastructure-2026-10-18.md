# Window infrastructure checks — 2026-10-18

This is an operational checkpoint, not a completed deployment receipt.

## Oracle capacity

Verified through the configured `oracle` SSH alias:

- Root filesystem: 96 GB total, 52 GB used, 45 GB available, 54% used.
- Memory: 11 GiB total, 6.3 GiB available; no swap.
- Existing WordPress, Job Applicator, Coolify and standalone `postgres` retained.

## New dedicated database

Created through Coolify's resource workflow under the verified Window project.

| Setting | Value |
| --- | --- |
| Project | `w4xhycgnvog78pairrf7y1yw` — Window Extension Backend |
| Environment | `kx09zsobv8r6203tjz5ok43u` — production |
| Resource/container UUID | `w2c1as5kuqogvg0mb4jilfvy` |
| Name | `window-postgres` |
| Image | `postgres:18-alpine` |
| Initial database | `window` |
| Administrative user | `postgres` |
| TLS | Enabled, mode `require` |
| Public availability | Disabled; no host port mappings |
| Backup schedule UUID | `v11ax0enmeoy105mbqlehj7n` |
| Backup frequency | `0 8 * * *`, 08:00 UTC daily (Coolify instance timezone verified UTC) |
| Backup destination | Local; no validated S3 storage configured |
| Local retention | Seven backups, seven days |

Independent CLI checks confirmed the container healthy, `current_database()` =
`window`, `current_setting('ssl')` = `on`, and zero public tables before restore.
Docker reported `5432/tcp` without a published host port. The new database is not
the unrelated container named `postgres`.

The backup schedule was saved and enabled for the `window` database only, with
`dump_all=false`. Retention was set through Coolify's installed model using SSH,
after verifying the schedule belongs to this resource. No execution had occurred
at the initial checkpoint. After restore, the first backup dispatched through
Coolify's `DatabaseBackupJob` succeeded at 22:26:53 UTC. Execution ID `1`,
1,079,525 bytes:
`/data/coolify/backups/databases/root-team-0/window-postgres-w2c1as5kuqogvg0mb4jilfvy/pg-dump-window-1792362412.dmp`.
Independent `pg_restore --list` validation found 35 table definitions and 35 table
data entries. The new backup was then restored successfully with
`pg_restore --exit-on-error --no-owner --no-privileges` into a separate temporary
database, `window_backup_verify_20261018`. Counts matched: 1 user, 18 packs and
2,952 questions. That verification database was removed after the check; the
live `window` database and backup file were retained.

## Restored data verification

Independent read-only PostgreSQL checks after Claude's restore confirmed:

- 35 public tables.
- 1 user, 18 quiz packs, 2,952 quiz questions.
- All 11 recorded migrations finished, none rolled back, including
  `20260911000000_quiz_deepdive_skillid`.

## Local validation

On Claude's existing worktree, backend `typecheck` and `typecheck:worker` passed.
The targeted `cloudflareRuntime` and `jobProcessing` suites passed 22/22 tests.
These checks do not establish a successful public deployment or Google login.

## Independent public verification

At 22:41:54–55 UTC, after the edge certificate became active, direct HTTPS
requests to `https://api.window.explosion.fun` confirmed:

- `/healthz`: HTTP 200, `ok=true`, service `window-backend`.
- `/readyz`: HTTP 200, database reachable, latest migration applied, no failed
  migrations and no queued or running jobs at that sample.
- `/v1/auth/me` without a bearer session: HTTP 401.
- A Chromium extension origin receives the matching CORS allow-origin header;
  an unrelated HTTPS website receives no CORS allow-origin header.

Cloudflare's CLI independently reported VPC service
`01a15126-a025-73b3-85ff-93f7b918d114`, hostname `window-db.explosion.fun`, TCP
5432 through tunnel `c52dfb9d-1eb1-4368-9817-9ec469427287`, with TLS mode
`verify_full`. The database certificate issuer is Cloudflare Origin CA and its
expiry is 2028-10-17 22:27 UTC. No TLS verification bypass was applied.

See the main receipt for authenticated requests, background-job verification,
final resources, restart recovery and the Google login verification limit.

## Coordination and access

Continue original Claude Sonnet 5.5 session
`2f28c906-8cc1-4b49-bc4e-a782fadd0045` with saved settings and normal auto review.
CLI resume attempts with changed flags produced copies `d95109ab` and `55ea8710`;
both were stopped. A stopped original resumes with `claude --bg --resume <id>`
without overriding saved options. A running original must not be resumed this
way because the CLI starts a copy.

Claude's auto review rejected creating a broad Coolify API token over SSH as
`Remote Shell Writes`. No token was created through that rejected command.
The authenticated existing Coolify resource UI provided a narrower provisioning
path. The owner subsequently requested CLI access for remaining operations.

Archive restore, migrations, private Cloudflare connection, deployment and live
authentication/job checks remain to be completed in the main deployment receipt.
Neon remains preserved. The owner explicitly selected **Keep mock staging for
now** in this Window chat. Mock OpenClaw behavior is the selected deployment
scope; a real adapter is not authorized.
