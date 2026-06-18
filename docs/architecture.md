# Architecture

Window is split into four runtime layers:

1. Chrome extension surfaces
2. Chrome extension service worker and local state
3. Fastify backend API
4. Background worker and OpenClaw connector

## Runtime components

| Component | Main paths | Responsibility |
| --- | --- | --- |
| Popup | `src/popup/` | Current focus state, task queue, points, account status, calendar blocks, idea capture |
| Options | `src/options/` | Calendar workspace, rules, settings, and configuration-heavy flows |
| Blocked page | `src/blocked/` | User-facing redirect when a site is blocked; break controls |
| Side panel | `src/sidepanel/` | Secondary extension surface |
| Content scripts | `src/content/` | In-page quiz panel/FAB behavior |
| Service worker | `src/background/` | Calendar sync, DNR blocking rules, alarms, local queueing, backend sync, notifications |
| Shared domain | `src/shared/` | Rule resolution, storage, profiles, task library, analytics, launch targets, learning state |
| Backend API | `backend/src/app.ts`, `backend/src/server.ts` | Auth, sessions, ideas, learning, connectors, sync, serialized API responses |
| Backend worker | `backend/src/worker.ts` | Claims queued jobs, executes assistant/learning work, records results |
| Database | `backend/prisma/schema.prisma` | Users, sessions, ideas, OpenClaw state, analytics, learning topics, quiz progress, jobs |

## Focus blocking flow

1. Google Calendar events are synced by the extension background modules.
2. The active event is matched against explicit event rules or keyword fallbacks.
3. Rule resolution combines event-specific domains with global allowlist behavior.
4. The background worker writes Chrome `declarativeNetRequest` rules.
5. Disallowed navigation redirects to the blocked page.
6. A snooze/break clears blocking temporarily and schedules an alarm to reapply rules.

The important domain logic lives in `src/shared/blockingSchedule.ts`, `src/shared/eventRules.ts`, and `src/shared/ruleResolution.ts`. Keep this logic testable and independent from Chrome APIs.

## Account and backend sync

The extension should remain useful locally, but backend-backed features need a session. Account and session logic spans:

- `src/shared/account.ts`
- `src/background/backend.ts`
- `backend/src/lib/auth.ts`
- `backend/src/lib/serializers.ts`

Backend API responses should go through serializers before reaching the extension. Avoid returning raw Prisma rows to clients.

## Assistant and idea pipeline

1. The user captures an idea in the popup.
2. The extension saves it locally first.
3. The extension posts the idea to the backend when a backend session is available.
4. The backend stores an `IdeaCapture` and queues an assistant job.
5. The worker claims the job.
6. The OpenClaw connector runs the task through `mock`, `ssh`, or `http`.
7. The result is persisted and later fetched by the extension.

The connector boundary is under `backend/src/lib/openclaw/`. Keep provider-specific behavior behind that boundary so the extension does not need to know how assistant execution is hosted.

## Learning system

The learning system has two sides:

- Extension UI/state for quiz and review behavior.
- Backend content generation, imports, learning jobs, topic metadata, and progress persistence.

Authoring scripts live in `backend/scripts/quiz_banks/`. Runtime learning code lives under `backend/src/lib/learning.ts` and shared extension learning files under `src/shared/learning.ts`.

## Deployment shape

The extension is distributed as a built Chrome extension. The backend is a normal Node service plus a separate worker process. The Oracle deployment files assume:

- Caddy terminates HTTP(S)
- `window-api.service` runs the Fastify API
- `window-worker.service` runs the job worker
- `window-db-backup.*` handles database backups

Production deployments should run API and worker separately so long-running assistant jobs do not block user requests.
