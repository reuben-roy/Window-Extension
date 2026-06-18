# Window developer docs

Window is a Chrome extension plus a self-hosted backend. The extension handles local browser behavior: calendar sync, focus blocking, breaks, popup UI, side panel UI, and local sync queues. The backend handles account/session state, OpenClaw connector state, idea jobs, learning content, analytics, and worker execution.

Use these docs when changing the product for another user, another deployment, or another hosted backend.

## Docs map

| Document | Use it for |
| --- | --- |
| [Developer quickstart](developer-quickstart.md) | Local extension, backend, worker, database, and test workflows |
| [Architecture](architecture.md) | Runtime components and data flow across extension, API, worker, OpenClaw, and PostgreSQL |
| [Customization guide](customization.md) | Making Window configurable for more users and deployments |
| [Learning deployment](window-learning-deployment.md) | Existing deployment notes for the learning system |
| [Popup surface spec](window-popup-surface-spec.md) | Existing UI/product spec for popup behavior |

## Repository areas

| Path | Responsibility |
| --- | --- |
| `src/background/` | Chrome service worker modules for calendar sync, blocking rules, points, analytics, backend sync, and task queues |
| `src/popup/` | Main user surface for active tasks, points, account state, calendar blocks, and idea capture |
| `src/options/` | Calendar workspace and settings |
| `src/blocked/` | Redirect target shown when browsing is blocked |
| `src/content/` | Injected quiz UI surfaces |
| `src/shared/` | Pure extension domain logic, storage helpers, types, rules, task libraries, launch targets, and analytics models |
| `backend/src/` | Fastify API, worker, auth/session logic, OpenClaw connector, learning jobs, serializers, and Prisma access |
| `backend/prisma/` | PostgreSQL schema and migrations |
| `backend/scripts/` | Learning corpus, quiz-bank authoring/import, validation, backups, and operational scripts |
| `ops/oracle/` | Caddy and systemd units for a self-hosted API/worker deployment |

## Documentation rule

Add or update docs whenever a change affects setup, deployment, browser permissions, backend environment variables, database shape, connector behavior, or any setting that a non-original user should be able to customize without reading source code.
