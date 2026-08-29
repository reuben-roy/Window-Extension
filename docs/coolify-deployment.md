# Coolify deployment

Window's server-side runtime is three services:

1. PostgreSQL, which owns all persistent state.
2. The public Fastify API on port `8787`.
3. A private worker that polls PostgreSQL and executes queued research,
   assistant, and learning jobs.

The Chromium extension remains client-side. Build it with
`VITE_WINDOW_BACKEND_URL=https://<api-hostname>` so it calls the deployed API.

## Prerequisites

- A Coolify project and environment.
- A public DNS name for the API.
- A PostgreSQL connection string. A Coolify-managed PostgreSQL resource is the
  simplest option; an existing Neon database also works.
- A decision about the OpenClaw transport. `mock` is safe for an initial smoke
  deployment. `http` or `ssh` needs the corresponding endpoint and credential.

Do not commit any of these values. Store them in Coolify's environment-variable
settings and mark credentials as secrets.

## 1. PostgreSQL

Create or select a PostgreSQL resource and retain its internal connection URL.
The database is the only runtime component that needs persistent storage. If
Coolify manages it, use the volume and backup controls on that database
resource. The API and worker are stateless and need no volumes.

## 2. API application

Create an application from this Git repository with these settings:

- Build pack: `Dockerfile`
- Base directory: `/backend`
- Dockerfile location: `/backend/Dockerfile` (or `Dockerfile` when Coolify
  resolves it relative to the base directory)
- Port: `8787`
- Start command: use the image default, `npm start`
- Health check path: `/healthz`
- Health check expected status: `200`
- Public domain: the chosen HTTPS API hostname

Set these environment variables:

```ini
NODE_ENV=production
PORT=8787
DATABASE_URL=<postgres-connection-url>
OPENCLAW_TRANSPORT=mock
WORKER_POLL_INTERVAL_MS=5000
```

Add the other `OPENCLAW_*` variables from `backend/.env.example` only when the
selected transport needs them. `GOOGLE_TOKENINFO_URL` has a working default.

The health endpoint is a process liveness check. Database readiness is verified
separately by running migrations and exercising an authenticated API flow.

Coolify's generated hostname can be used for the initial smoke deployment. The
application does not read its own public URL from an environment variable, so a
fixed hostname can be attached later without rebuilding or restarting for an
application configuration change.

## 3. Database migrations

Before routing extension traffic to a new release, run this command once using
the newly built application image and the same `DATABASE_URL`:

```bash
npx prisma migrate deploy --schema prisma/schema.prisma
```

Run migrations as a Coolify one-off command or pre-deploy command. Do not run
`prisma migrate dev` in production. Avoid putting migration execution in both
the API and worker startup commands, because simultaneous deploys can race.

The bundled learning corpus is not loaded by migrations. If the learning quiz
catalog is required, run this separate one-off command after migrations:

```bash
npm run import:learning-quizzes
```

Adding `-- --activate-user-email <email>` changes application data for that
user, so only do that when the target account has been explicitly chosen.

## 4. Worker application

Create a second Coolify application from the same repository and Dockerfile:

- Build pack: `Dockerfile`
- Base directory: `/backend`
- Dockerfile location: `/backend/Dockerfile`
- Start command override: `npm run start:worker`
- Public domain: none
- Public port: none

Give it the same `DATABASE_URL`, `OPENCLAW_*`, and
`WORKER_POLL_INTERVAL_MS` values as the API. The worker does not listen on a
port. Verify it from logs: it should remain running without repeated
`[window-worker] job loop failed` messages. A stronger end-to-end check is to
submit one job through the API and confirm the worker moves it out of `queued`.

Run exactly one worker replica unless job-claiming behavior has been load-tested
for concurrency.

## 5. Extension build

The backend URL is compiled into the extension. Rebuild and redistribute the
extension after the API hostname is final:

```bash
VITE_WINDOW_BACKEND_URL=https://<api-hostname> npm run build
```

The extension's manifest already permits HTTPS hosts through `<all_urls>`.

## Attaching the fixed subdomain later

Do not remove the temporary Coolify hostname first. Use this order so existing
extension builds continue to work during the transition:

1. Create the DNS record requested by Coolify for the selected subdomain.
2. Add `https://<fixed-subdomain>` to the API application's domain list and
   wait for Coolify to issue a valid TLS certificate.
3. Verify `https://<fixed-subdomain>/healthz` returns HTTP 200.
4. Rebuild the extension with
   `VITE_WINDOW_BACKEND_URL=https://<fixed-subdomain>` and distribute that
   build.
5. Exercise Google sign-in and one authenticated API request from the rebuilt
   extension.
6. Keep the temporary hostname attached until all extension installations that
   matter have upgraded; then it can be removed.

No API environment variable or CORS allowlist needs changing for the current
code. The backend sends `Access-Control-Allow-Origin: *` and authenticates API
calls with a bearer token rather than a cross-site cookie. If CORS is tightened
later, allow the Chrome extension origin (`chrome-extension://<extension-id>`),
not merely the public API hostname. The public hostname is the request
destination, while the extension origin is the browser-enforced caller origin.

## Verification checklist

1. The API application is healthy and `GET /healthz` returns
   `{"ok":true,"service":"window-backend"}`.
2. The migration command exits successfully.
3. The worker remains running and its logs show no recurring database or
   OpenClaw errors.
4. The extension was built with the final HTTPS backend URL.
5. Google sign-in succeeds and an authenticated endpoint such as `/v1/auth/me`
   responds through the public domain.
6. If learning is enabled, the quiz corpus import completed and a learning pack
   is returned from the API.
7. If OpenClaw is not using `mock`, its health test succeeds without exposing
   the API token in logs.

## Backups

For a Coolify-managed database, configure scheduled database backups in
Coolify. When using the existing Oracle backup script instead, its container or
host must have `pg_dump` and the Oracle CLI available; those tools are not part
of the application image.
