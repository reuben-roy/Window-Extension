# Cloudflare deployment

Window's backend runs on Cloudflare Workers. This replaces the retired Oracle
host services and Coolify applications (`docs/coolify-deployment.md`,
`ops/oracle/`), which are kept only for history. Deployment status and evidence
are in `docs/cloudflare-deployment-receipt.md`.

## Architecture

| Piece | Implementation |
| --- | --- |
| Public API | Worker `window-backend` at `https://api.window.explosion.fun` (custom domain on the `explosion.fun` zone). The unchanged Fastify app is hosted through the Workers `node:http` server shim (`cloudflare:node` `handleAsNodeRequest`). |
| Background jobs | `JobProcessor` Durable Object (SQLite-backed), the single consumer of the research, assistant and learning queues. It runs on demand and re-arms an alarm only while work remains. |
| Wake-ups | A successful enqueue request kicks the processor; a `*/15` cron trigger is a safety net that recovers missed kicks and fails interrupted jobs. |
| Database | Dedicated PostgreSQL 18 (`window-postgres`, Coolify resource `w2c1as5kuqogvg0mb4jilfvy`, database `window`, TLS on, no published port) on the existing Coolify server, restored from the archived Window database. Reached privately: Worker → Hyperdrive → Workers VPC TCP service → Cloudflare Tunnel `window-postgres-oracle` (connector container `window-postgres-tunnel` on the `coolify` Docker network) → Postgres, with the VPC service verifying the certificate (`verify_full`). No database port is exposed publicly. |
| ORM | Prisma 6.19 with `engineType = "client"` and the `@prisma/adapter-pg` driver adapter. One client is created per invocation (Workers cannot reuse sockets across requests). |
| Auth | Unchanged: the extension signs in with Google, the API verifies the Google access token (`/v1/auth/google/exchange`) and issues its own 7-day bearer session token stored hashed in `BackendSession`. Window does not use Auth0. |
| OpenClaw | **Mock staging.** See "OpenClaw" below. |

### Why the app is built at module load

Fastify's router compiles lookups with `new Function`, which Workers allows only
while the module is evaluated. `src/cloudflare/index.ts` therefore calls
`buildApp()` at startup (with `pluginTimeout: 0`, because timers are also
disallowed at startup) and calls `app.ready()` and `server.listen()` on the
first request.

### Job processing semantics

- Jobs are claimed with a conditional `updateMany` (`status = 'queued'`), so
  overlapping callers never process one job twice. The Durable Object also runs
  one alarm at a time.
- `failStaleJobs` fails research and learning jobs left `running` longer than
  `JOB_STALE_AFTER_MS` (default 10 min), which only happens when an isolate was
  interrupted; the user can retry them. Assistant jobs stay `running` while the
  remote task executes and are polled (no faster than every 15 s). A job with no
  remote job id is failed by the existing poll logic.
- The processor goes idle when the queues drain, so the database can autosuspend
  or idle instead of being polled every 5 s as the old worker did.

## Configuration

`backend/cloudflare.config.ts` is the deployment definition (`cf` CLI; there is
no Wrangler config). Plain variables live there; secrets do not.

| Name | Kind | Purpose |
| --- | --- | --- |
| `HYPERDRIVE` | binding | Hyperdrive config (id read from `WINDOW_HYPERDRIVE_ID` at deploy time) |
| `JOB_PROCESSOR` | binding | Durable Object namespace |
| `OPENCLAW_TRANSPORT` | var | `mock` (staging) |
| `OPENCLAW_FETCH_MODE` | var | `strict` |
| `CORS_ALLOWED_ORIGINS` | var | `chrome-extension://*` (empty means any origin) |
| `WORKER_POLL_INTERVAL_MS` | var | processor poll interval |
| `JOB_STALE_AFTER_MS` | var (optional) | stale-job cutoff |
| `OPENCLAW_ALLOWED_HOST_SUFFIXES`, `OPENCLAW_API_TOKEN`, `OPENCLAW_HTTP_BASE_URL` | secret/var | only when `OPENCLAW_TRANSPORT=http` |

No Worker secret is required for the mock configuration: the database
credentials live in the Hyperdrive config. The `ssh` OpenClaw transport cannot
run on Workers (no subprocesses); use `http`.

Build-time environment (not committed): `WINDOW_HYPERDRIVE_ID`, and for local
runs `WINDOW_LOCAL_DATABASE_URL` (Hyperdrive local connection string).

## Release procedure

```sh
cd backend
npm ci
npm run typecheck && npm run typecheck:worker
(cd .. && npx vitest run tests/cloudflareRuntime.test.ts tests/jobProcessing.test.ts)

# 1. Migrations: once, from a trusted machine, against the production database.
#    Never `prisma migrate dev` or a reset in production.
DATABASE_URL=<direct-url> npx prisma migrate deploy --schema prisma/schema.prisma

# 2. Deploy
WINDOW_HYPERDRIVE_ID=<hyperdrive-id> cf deploy --message "<release note>"
```

Migration-before-code order matters: `/readyz` reports 503 until the newest
migration (`LATEST_MIGRATION` in `src/lib/readiness.ts`, checked against
`prisma/migrations` by a test) is applied.

The quiz corpus is **not** loaded by migrations. The archived database already
holds 18 packs / 2,952 questions. `npm run import:learning-quizzes` replaces
canonical packs and resets spaced-repetition progress for them, and
`--activate-user-email` changes a user's active topics: do not run either
without a chosen target.

## Private database connection (TLS)

Workers VPC trusts publicly trusted CAs and Cloudflare Origin CA only, so the
Coolify private-CA certificate cannot be verified. The database therefore serves a
Cloudflare Origin CA certificate for `window-db.explosion.fun`, and the VPC
service verifies it with `verify_full`. Never set `disabled`.

- Certificate files: `/data/coolify/databases/w2c1as5kuqogvg0mb4jilfvy/ssl/server.{crt,key}`
  (bind-mounted by Coolify), with a root-only copy in `/etc/window-db-tls/`.
  `ops/oracle/window-db-tls.sh install|reinstall|status` is idempotent; it writes
  files in place (Docker bind-mounts single files by inode) and reloads Postgres,
  restarting the container only if its mount went stale.
- Name resolution: a DNS-only A record `window-db.explosion.fun` → the database
  container's private address, resolved by the tunnel through `1.1.1.1` (the Oracle
  host resolver drops private answers). `ops/oracle/sync-window-db-dns.sh` updates
  the record after the container address changes.
- Connector: `ops/oracle/window-db-tunnel.sh` recreates the `cloudflared` container
  (it does not depend on the database address).
- Renewal: the Origin CA certificate expires 2028-10-17. Issue a new one
  (`cf ssl origin-ca-certificates create` with a fresh CSR, validity 730 days),
  then `window-db-tls.sh install <crt> <key>`.
- After a **Coolify redeploy** of the database: Coolify rewrites the certificate
  files from its own records. Until the Origin CA certificate is stored in those
  records (`ops/oracle/window-db-coolify-cert.sh apply`, see the receipt's open
  items), run `sudo window-db-tls.sh reinstall` and `sync-window-db-dns.sh`.
  Symptom of a miss: `/readyz` returns 503.

## Health and operations

- `GET /healthz`: process liveness only.
- `GET /readyz`: database reachable, no failed migrations, newest migration
  applied, plus queue depth (`queued`, `running`, `oldestQueuedSeconds`). 503
  otherwise.
- Logs: structured JSON via Workers Logs (invocation logs and traces enabled).
  Request lines carry method, path, status and duration only; headers and bodies
  are never logged. 5xx and unclassified errors are logged with the error.
  Check recent logs with the dashboard (Workers → `window-backend` → Logs) or
  `cf workers` observability commands.
- A repeating `job cycle failed` log line means the processor cannot reach the
  database; it retries every 30 s.

## Backups and recovery

- The archived dump from the retired deployment is private on Oracle:
  `/data/coolify/backups/retired-window-20261018T191206Z/` (root-only).
  Keep it.
- The new Coolify database has a scheduled backup (`v11ax0enmeoy105mbqlehj7n`):
  daily `0 8 * * *` (UTC), `window` database only, local storage, 7 backups /
  7 days retained. Coolify has no off-host S3 destination, so dumps live on the
  same host as the database: copy them off the host periodically.
- Manual logical backup (needs network access to the database):
  `backend/scripts/backup-postgres.sh` (`pg_dump --format=custom`).
- Restore: create an empty database, `pg_restore --no-owner --dbname <url> <dump>`
  (or `psql -f` for plain dumps), then `prisma migrate deploy`. A restore of the
  archived dump plus the one pending migration was rehearsed in a throwaway
  container (see receipt).

## Rollback

- Code: `cf workers versions` lists versions; redeploy a previous version with
  `cf workers deployments` (or `git revert` and `cf deploy`). The schema change
  that shipped with this work is additive and idempotent
  (`20260911000000_quiz_deepdive_skillid`), so older code keeps working.
- Database: stop traffic (remove the custom domain or deploy a version that
  returns 503), restore the last Coolify backup into a new database, point a new
  Hyperdrive config at it, and redeploy with its id.
- The Neon database from the retired host deployment was left untouched
  (quota-blocked) and is not referenced by this deployment.

## OpenClaw

Both retired production deployments ran `OPENCLAW_TRANSPORT=mock`. The OpenClaw
gateway on Oracle serves only its web UI on loopback; nothing implements the
`/api/window/*` endpoints that Window's `http` transport calls (`health`,
`sessions`, `ideas/evaluate`, `tasks`, `tasks/:id`, cancel). Research and
assistant jobs therefore complete with **mock results**. This is staging
behaviour, not a working OpenClaw integration. Closing the gap needs an adapter on
the OpenClaw side plus a secured public route, then `OPENCLAW_TRANSPORT=http`.
