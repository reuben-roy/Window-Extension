# Developer quickstart

## Prerequisites

- Node.js 20 or newer
- npm
- PostgreSQL for backend state
- Chrome or a Chromium browser for extension loading
- Optional: Python 3 for quiz-bank authoring scripts
- Optional: an OpenClaw instance for non-mock assistant execution

## Install dependencies

From the repo root:

```bash
npm install
npm install --prefix backend
```

The backend runs `prisma generate` after install. If Prisma client generation needs to be rerun manually:

```bash
npm run prisma:generate --prefix backend
```

## Backend environment

Create `backend/.env` with at least:

```ini
DATABASE_URL=postgresql://user:password@localhost:5432/window
PORT=8787
OPENCLAW_TRANSPORT=mock
```

Supported backend variables are parsed in `backend/src/env.ts`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | required | PostgreSQL connection string used by Prisma |
| `PORT` | `8787` | Fastify API port |
| `GOOGLE_TOKENINFO_URL` | Google tokeninfo URL | Backend validation endpoint for Google identity tokens |
| `OPENCLAW_TRANSPORT` | `mock` | Assistant transport: `mock`, `ssh`, or `http` |
| `OPENCLAW_SSH_HOST` | empty | SSH host for an OpenClaw server |
| `OPENCLAW_SSH_USER` | empty | SSH user |
| `OPENCLAW_SSH_KEY_PATH` | empty | SSH key path |
| `OPENCLAW_REMOTE_BASE_URL` | `http://127.0.0.1:3000` | Remote OpenClaw URL used over SSH |
| `OPENCLAW_API_TOKEN` | empty | Token for OpenClaw API access |
| `OPENCLAW_HTTP_BASE_URL` | empty | Direct HTTP OpenClaw endpoint |
| `OPENCLAW_FETCH_MODE` | `permissive` | URL fetch policy for OpenClaw tasks |
| `OPENCLAW_ALLOWED_HOST_SUFFIXES` | empty | Comma-separated allowlist used in strict fetch mode |
| `OPENCLAW_MOCK_LATENCY_MS` | `2500` | Mock connector latency |
| `WORKER_POLL_INTERVAL_MS` | `5000` | Worker polling cadence |

## Database

Run migrations from `backend/`:

```bash
npm run prisma:migrate --prefix backend
```

For production-like deployments, use Prisma deploy semantics against the target database:

```bash
npx prisma migrate deploy --schema backend/prisma/schema.prisma
```

## Run locally

Use separate terminals:

```bash
npm run dev:backend
npm run dev:backend-worker
npm run dev
```

For isolated UI development without extension packaging:

```bash
npm run dev:ui
npm run dev:popup
```

## Load the extension

1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Load the generated extension build directory.
5. Connect Google Calendar from the extension UI.

During regular development, use the Vite dev server for UI iteration and rebuild the extension when testing Manifest V3 service-worker behavior.

## Tests and checks

```bash
npm run test
npm run typecheck
npm run typecheck:backend
npm run build
npm run build:backend
```

Run tests around the feature area being changed. Shared logic under `src/shared/` has direct unit coverage and should stay pure where possible.

## Learning content workflows

Quiz content is generated and imported through backend scripts:

```bash
npm run author:learning-quizzes --prefix backend
npm run validate:quiz-banks --prefix backend
npm run import:learning-quizzes --prefix backend
```

Keep generated quiz artifacts under `backend/data/learning/` and source authoring logic under `backend/scripts/quiz_banks/`.
