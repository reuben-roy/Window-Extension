# Cloudflare deployment receipt

**Status: IN PROGRESS. Not deployed. The job-applicator follow-up note must not be marked complete yet.**
Last updated 2026-10-18. No secret values appear in this file.

## Done

| Item | Evidence |
| --- | --- |
| Runtime adaptation | Fastify app served from workerd via `node:http` shim; Prisma 6.19 `engineType=client` + `pg` adapter; per-invocation client; `JobProcessor` Durable Object; cron safety net. Built with `cf build`, bundle about 1.4 MB gzip. |
| Local workerd verification | `vite preview` of the production build against a restored copy of the archived DB: `/healthz` 200; `/readyz` ok (`latestApplied: true`, no failed migrations); bearer-authenticated `/v1/auth/me` returned the synthetic user; invalid auth gives 401, bad body 400; `POST /v1/ideas` enqueued a research job, the Durable Object processed it, `ResearchJob`/`IdeaCapture` reached `completed` and an `IdeaReport` row existed (mock transport), log line `job cycle processed=1`. |
| Node path unchanged | `tsx src/server.ts` against the same DB: `/readyz` ok, authenticated request ok. |
| Archive restore drill | `coolify-window-postgres.sql.gz` (gzip ok) restored into a throwaway Postgres 17 container: 1 user, 18 `QuizPack`, 2,952 `QuizQuestion`, 10 migrations recorded. (Restoring the dump replaces the `postgres` role password hash; a new instance should restore only the Window database objects, not global roles.) |
| Pending migration | `prisma migrate deploy` applied `20260911000000_quiz_deepdive_skillid` cleanly on the restored archive (columns already existed; the migration is idempotent). |
| Tests | `backend`: `tsc` and `tsc -p tsconfig.worker.json` clean. `tests/cloudflareRuntime.test.ts` and `tests/jobProcessing.test.ts` plus existing `backendRootRoute`/`productionBackendConfig`: 24 passed. |
| Extension config | `.env.production` already has `VITE_WINDOW_BACKEND_URL=https://api.window.explosion.fun`; covered by `tests/productionBackendConfig.test.ts`. No change needed. |

## Findings

- Neon (host deployment's database) rejects all connections: "exceeded the quota". Left untouched; not used.
- Both retired deployments ran `OPENCLAW_TRANSPORT=mock`; no `/api/window/*` server exists (see `cloudflare-deployment.md`). **OpenClaw integration is unresolved; deployment stays labelled mock staging.**
- Cloudflare account: Workers Free plan, no existing Workers/Hyperdrive/Queues/tunnels; zone `explosion.fun` (`2d2e6ba37ebce5a62425af3ec1183974`) active with no `api.window` record. Free-plan limits (10 ms CPU per request) are untested against the live runtime.
- `explosion.fun` still has an `auth.explosion.fun` A record from the retired Keycloak; untouched.

## Blocker (needs the owner)

Provisioning the Coolify PostgreSQL from this session was denied by the Claude Code
auto-mode permission review: minting a Coolify API token on the Oracle host
(`php artisan tinker` creating a Sanctum token) was refused as a remote credential
write, and the Coolify dashboard cannot be driven (login is human-only; the browser
harness could not attach to Chrome). Coolify 4.0.0 on Oracle has API access enabled;
there is no existing token for it in this session. Options: (a) the owner creates a
Coolify API token (Keys & Tokens → API tokens, `read` + `write`) and exposes it as a
file on Oracle readable by `ubuntu`, or adds a permission rule allowing the token
creation command; (b) the owner creates the PostgreSQL resource in the dashboard.

## Remaining steps

1. Coolify: Postgres 17 in server `zz3zxup4t5rgvyv5dwrj4wdh`, project `w4xhycgnvog78pairrf7y1yw`, environment `kx09zsobv8r6203tjz5ok43u`; no public port; TLS enabled; scheduled backups.
2. Restore only the Window database objects from the archive; apply the pending migration; verify counts.
3. Cloudflare Tunnel + connector on Oracle, Workers VPC TCP service (`cf workers-vpc services create --type tcp --app-protocol postgresql`), Hyperdrive (`cf hyperdrive create --origin-service-id …`, caching disabled).
4. `cf deploy`; verify `https://api.window.explosion.fun` (DNS, TLS, `/healthz`, `/readyz`), authenticated request with a synthetic session, a research job to `completed`, learning read endpoints, and clean logs.
5. Fill in resource IDs and live evidence here, then mark the follow-up note complete.

## Changed files

See `git log codex/window-cloudflare`. Main areas: `backend/cloudflare.config.ts`,
`backend/src/cloudflare/*`, `backend/src/lib/{prisma,jobs,readiness,cors}.ts`,
`backend/src/{app,env,worker}.ts`, `backend/prisma/schema.prisma` (generator only),
`backend/scripts/import_learning_quizzes.mjs` (adapter), `tests/cloudflareRuntime.test.ts`,
`tests/jobProcessing.test.ts`, `docs/cloudflare-deployment*.md`.
