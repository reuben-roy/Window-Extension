# Cloudflare deployment receipt

**Status: DEPLOYED and verified through `https://api.window.explosion.fun` on 2026-10-18, as _mock staging_ for OpenClaw (owner-selected scope). Certificate persistence and a real Coolify redeploy were verified. Google sign-in itself is not verified (needs a human).**
No secret values appear in this file. Companion: `docs/window-infrastructure-2026-10-18.md` (Coolify/database checkpoints), `docs/cloudflare-deployment.md` (architecture and runbook).

## Architecture and resources

Worker `window-backend` (Fastify via `node:http` shim) → Hyperdrive → Workers VPC service → Cloudflare Tunnel → `cloudflared` on Oracle → Coolify PostgreSQL 18 over TLS (Cloudflare Origin CA certificate, `verify_full`). Job processing: `JobProcessor` Durable Object (SQLite) + `*/15` cron safety net.

| Resource | Identifier |
| --- | --- |
| Worker / version | `window-backend`, version `07b6beaa-445a-4ace-a1f3-67ac28e3c1c6`; custom domain `api.window.explosion.fun` (production only; workers.dev disabled); cron `*/15 * * * *`; Durable Object class `JobProcessor` |
| Hyperdrive | `window-postgres`, `88be7b840568402db221293c9edf35a9`, origin = VPC service, caching disabled, connection limit 20 |
| Workers VPC service | `window-postgres`, `01a15126-a025-73b3-85ff-93f7b918d114`: TCP 5432, `postgresql`, host `window-db.explosion.fun` resolved via tunnel using resolver `1.1.1.1`, `cert_verification_mode = verify_full` |
| Tunnel | `window-postgres-oracle`, `c52dfb9d-1eb1-4368-9817-9ec469427287` (remotely managed, healthy); connector container `window-postgres-tunnel` on Oracle (network `coolify`, no published ports, `--restart unless-stopped`, token file mode 600 in `~ubuntu/.window-deploy/`) |
| DNS | `window-db.explosion.fun` A → `10.0.2.5` (DNS-only, private address, record id `6a7bdc33e8d8987392046018c3149e3b`); `api.window.explosion.fun` created by the Worker custom domain. No sibling records changed. |
| Origin CA certificate | id `568198235192069954034760883063714305877547998020`, `origin-rsa`, SAN `window-db.explosion.fun`, valid until 2028-10-17 22:27 UTC. Key generated locally, installed root-only: `/etc/window-db-tls/origin.{crt,key}` on Oracle and the database's bind-mounted `ssl/server.{crt,key}` |
| Database | Coolify resource `w2c1as5kuqogvg0mb4jilfvy` (`window-postgres`), `postgres:18-alpine`, db `window`, TLS on, no published port; project `w4xhycgnvog78pairrf7y1yw`, environment `kx09zsobv8r6203tjz5ok43u`, server `zz3zxup4t5rgvyv5dwrj4wdh` |
| Backup | Coolify schedule `v11ax0enmeoy105mbqlehj7n`, daily 08:00 UTC, `window` only, local, 7 backups/7 days; first run (execution 1, 1,079,525 bytes) and a restore into a scratch database were verified by Codex (`docs/window-infrastructure-2026-10-18.md`) |
| Repo | branch `codex/window-cloudflare` (remote `origin`) |

## Database source and migration

- Source: `/data/coolify/backups/retired-window-20261018T191206Z/coolify-window-postgres.sql.gz`. Neon (host deployment) rejected connections with a quota error and was left untouched.
- Restored from a clean throwaway Postgres 18 via `pg_dump --format=custom --no-owner --no-acl --schema=public` + `pg_restore --single-transaction --exit-on-error` (Window objects only, no global roles). After restore: 1 user, 1 auth identity, 18 `QuizPack`, 2,952 `QuizQuestion`, 6 `BackendSession`, 12 `UserLearningTopic`, 10 migrations.
- `prisma migrate deploy` ran once and applied `20260911000000_quiz_deepdive_skillid` (11 migrations recorded). No corpus import ran; no account was activated.

## Live verification (public hostname, 2026-10-18 22:41–22:45 UTC)

| Check | Result |
| --- | --- |
| DNS / TLS | `api.window.explosion.fun` resolves to Cloudflare; certificate issued automatically about 10 minutes after the first deploy (handshake failed until then) |
| `GET /healthz` | 200 `{"ok":true,"service":"window-backend"}` |
| `GET /readyz` | 200: `database: true`, `latestApplied: true`, `failed: []`, jobs `queued 0 / running 0`; about 0.13–0.47 s; 20 consecutive 200s |
| CORS | extension origin gets `Access-Control-Allow-Origin` echoed; `https://evil.example` gets none |
| Auth | no token → 401 `Missing backend session token.`; synthetic bearer session → 200 `/v1/auth/me`; `POST /v1/auth/google/exchange` with an invalid token → 400 `Google token verification failed.` (outbound Google call works). **A real Google sign-in was not performed (human-only); that path is unverified.** |
| Research job | `POST /v1/ideas` → status `queued` → `running` → `completed` with an `IdeaReport` (mock transport), processed by the Durable Object within about 6 s |
| Assistant task | `POST /v1/assistant-tasks` → `AssistantTaskJob` `completed` (mock) |
| Learning | `GET /v1/learning/taxonomy` 200 (7.7 KB); activating the existing `databases` topic for the synthetic user and `GET /v1/learning/review/next` returned a prompt from the restored corpus (Databases Mastery Pack, chapter 1). No learning job was needed. |
| Other reads | `/v1/account/snapshot`, `/v1/connectors`, `/v1/openclaw/status`, `/v1/learning/{user-topics,packs}` all 200 |
| Logs | Workers Logs/traces: only `request`, `job cycle` and Fastify debug lines; no errors, CPU-limit failures or repeating DB/transport failures. Scanners already probe `/.env*` paths and receive 404. |
| Database restart | `docker restart` of the database container: healthy again in seconds, same address, `/readyz` 200 afterwards (certificate files persisted) |
| Cleanup | The synthetic user and everything it created were deleted in one transaction; counts afterwards: 1 user, 6 sessions, 12 user topics, 18 packs, 2,952 questions (unchanged from the restore). The global "Primary OpenClaw" mock connector row created by the API on first use remains (it is required by the app). |
| Local tests | `tsc` and `tsc -p tsconfig.worker.json` clean; `tests/cloudflareRuntime.test.ts`, `tests/jobProcessing.test.ts`, `backendRootRoute`, `productionBackendConfig`: 24 passed |

## Coolify certificate persistence and redeploy test

Approved by the owner in the Window chat ("Approve certificate update and redeploy test"). Only resource `w2c1as5kuqogvg0mb4jilfvy` was touched; the server CA and sibling resources were not.

- **Records updated through Coolify's models** (`ops/oracle/coolify-window-db-cert.php`, run by `window-db-coolify-cert.sh apply` via `php artisan tinker`): `SslCertificate` id 2 now holds the Origin CA certificate and key (encrypted casts), `common_name = window-db.explosion.fun`, `subject_alternative_names = ["DNS:window-db.explosion.fun"]`, `valid_until = 2028-10-17 22:27:00`; `LocalFileVolume` ids 22 (`server.crt`) and 23 (`server.key`) hold the same content and were written in place with `saveStorageOnServer()`.
- **Fingerprints agree** (sha256 `114a6204…f1f6a9`) across the `SslCertificate` record, the `LocalFileVolume` record, the host file `ssl/server.crt`, the root-only store `/etc/window-db-tls/origin.crt`, and the certificate served on port 5432 (issuer Cloudflare Origin CA, SAN `window-db.explosion.fun`, TLS 1.3).
- **Real Coolify redeploy** (`App\Actions\Database\RestartDatabase`, the dashboard Restart code path: stop, remove container, start): container recreated (id `a616edfa…` → `cb39004c…`, created 23:08:22Z), healthy within 10 s, same address `10.0.2.5` (so `sync-window-db-dns.sh --dry-run` reported no change), no published ports. Coolify did not rewrite the certificate files on this path (inode and mtime unchanged); they and the records already matched, so the served certificate stayed correct.
- **After recovery, through the public hostname:** `/readyz` 200 (`database: true`, `latestApplied: true`, `failed: []`); no-token request 401; synthetic bearer session 200 on `/v1/auth/me`; a research job created and `completed` with a report within 3 s (mock transport); `/v1/learning/taxonomy` 200; restored data intact (2,952 questions). The VPC service still reports `cert_verification_mode = verify_full`. The synthetic user was deleted afterwards (counts: 1 user, 6 sessions, 0 ideas, 12 user topics, 18 packs, 2,952 questions).
- **Limits of this test:** it proves the certificate survives Coolify's restart/redeploy action, not that Coolify's start path would regenerate files from these records if the files were deleted (not tested; the records now carry the correct content, so such a regeneration would produce the Origin CA files). Coolify's own scheduled certificate renewal acts near `valid_until` (2028); renew before then.

## Notable decisions and findings

- **TLS:** the Coolify private-CA certificate cannot be verified by Workers VPC, and disabling verification was rejected by the auto-mode review. Instead a Cloudflare Origin CA certificate (trusted by Workers VPC) for `window-db.explosion.fun` was issued through `cf ssl origin-ca-certificates create` and the VPC service uses `verify_full`. Validity options are 7/30/90/365/730/1095/5475 days; 730 was chosen.
- **Hostname resolution:** the Oracle host resolver drops private answers (NXDOMAIN for a record pointing at 10.0.2.5), so the VPC service sets `resolver_ips: ["1.1.1.1"]` and a DNS-only record carries the container address.
- **Free plan:** the Worker runs on Workers Free (10 ms CPU limit); 20 consecutive requests, the job cycles and cold starts completed without CPU errors. Startup time 82 ms; upload 1.1 MB gzip.
- Fastify cannot use `app.inject` on Workers (`ServerResponse` is a class there) and compiles routes with `new Function`; see `docs/cloudflare-deployment.md` for the working approach.
- The Worker also answers plain `http://` requests (no redirect); the zone-wide "Always Use HTTPS" setting was not changed because the zone is shared.
- Scheduling decision: the old 5 s polling worker kept Neon awake continuously (likely cause of its quota exhaustion). The processor now idles when queues are empty.

## Open items

1. ~~Persist the Origin CA certificate in Coolify's own records.~~ **Resolved 2026-10-18** with the owner's explicit approval; see "Coolify certificate persistence and redeploy test" below.
2. Coolify's scheduled certificate renewal regenerates certificates shortly before `valid_until`; renew the Origin CA certificate (same scripts) before 2028-10-17.
3. After any recreation of the database container, run `ops/oracle/sync-window-db-dns.sh` (updates the DNS-only record to the container address); a database restart that keeps the address needs nothing.
4. OpenClaw is mock staging by owner decision; the real integration (an `/api/window/*` adapter and secured route) is unresolved.
5. Google sign-in end to end (extension → `/v1/auth/google/exchange`) needs a human to sign in.
6. Backups are local to the Oracle host only; copy them off-host.
7. Docker Desktop and scratch containers on the operator's Mac were started for local testing; they hold only archived/synthetic data.

## Rollback

- Code: `cf workers versions` / `cf workers deployments` to a prior version (none exists before `07b6beaa…`; use `git revert` + `cf deploy`, or remove the custom domain to take the API offline).
- Database: restore the latest Coolify backup into a new database, issue a certificate or reuse the Origin CA one, point a new VPC service/Hyperdrive config at it and redeploy with `WINDOW_HYPERDRIVE_ID`.
- Full retreat: delete the Worker, Hyperdrive config, VPC service, tunnel and the two DNS records; the retired deployments are not restored (archive kept at `/data/coolify/backups/retired-window-20261018T191206Z/`).

## Changed files

See `git log codex/window-cloudflare`: `backend/cloudflare.config.ts`, `backend/src/cloudflare/*`, `backend/src/lib/{prisma,jobs,readiness,cors}.ts`, `backend/src/{app,env,worker}.ts`, `backend/prisma/schema.prisma` (generator only), `backend/scripts/import_learning_quizzes.mjs`, `ops/oracle/{window-db-tls,window-db-tunnel,sync-window-db-dns,window-db-coolify-cert}.sh` and `coolify-window-db-cert.php`, `tests/cloudflareRuntime.test.ts`, `tests/jobProcessing.test.ts`, `docs/cloudflare-deployment*.md`, `docs/window-infrastructure-2026-10-18.md`.
