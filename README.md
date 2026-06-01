# Window

> A Chrome extension that transforms your browser into an intelligent productivity co-pilot — connecting to Google Calendar, blocking distractions during focus sessions, and running an OpenClaw-powered assistant layer for idea evaluation and task management.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Manifest](https://img.shields.io/badge/manifest-v3-green)
![License](https://img.shields.io/badge/license-all%20rights%20reserved-red)

---

At its core, Window connects to your Google Calendar, understands what you are supposed to be working on right now, and helps you stay focused by blocking distracting websites during scheduled focus sessions. It is designed to live where work already happens: inside the browser.

## What The Product Does

Window helps a user do four main things:

1. Stay focused during calendar-based work sessions
2. Control which websites are allowed during specific events
3. Take intentional breaks without fully disabling the system
4. Capture ideas for later evaluation without breaking focus

## Core Product Experience

### 1. Calendar-aware focus blocking

Window connects to Google Calendar and checks what event is active right now.

If the active event has a matching Event Rule, Window allows only the domains configured for that event and blocks the rest. If there is no exact Event Rule, Window can optionally fall back to keyword matching. If nothing matches, browsing stays unrestricted.

### 2. Event-specific whitelisting

Users can manage allowed sites per calendar event title.

Example:

- `Deep Work` might allow `github.com` and `docs.google.com`
- `Research Block` might allow `arxiv.org` and `claude.ai`
- `Admin Hour` might allow `gmail.com` and `calendar.google.com`

This makes Window more flexible than a simple global blocklist or global allowlist.

### 3. Intentional break handling

When a user is blocked, they can start a short break instead of turning the extension off completely.

Window currently supports:

- `5 min`
- `10 min`
- `15 min`

During the break, blocking is temporarily lifted. When the timer ends, blocking resumes if the focus event is still active.

### 4. Calendar workspace for rule management

Window includes a calendar workspace where users can browse their events and manage focus rules from a calendar view instead of a plain settings form.

The goal is to make whitelisting feel tied to the actual event, not buried in configuration.

### 5. Idea capture during focus

Window includes an idea capture flow in the popup so a user can quickly save an idea without opening another app or leaving their task.

The intended behavior is:

- capture the idea quickly
- return to work immediately
- let the system evaluate it in the background
- review the result later

This is meant to solve a common focus problem: users get interrupted by good ideas and lose either the idea or their momentum.

### 6. OpenClaw-powered assistant layer

Window is evolving beyond a focus blocker into a browser-native productivity assistant.

The current codebase includes the first phase of this system:

- backend session handling
- OpenClaw session controls
- async idea queueing
- background evaluation pipeline
- placeholder model selector UI

The assistant layer is designed so that intelligence runs outside the extension itself, while the extension remains the fast and secure user interface.

## Current Product Components

Window is made up of several parts that work together.

```mermaid
flowchart TB
  subgraph Client["Browser extension"]
    UI[Popup / Options / Blocked / Side panel]
    SW[Service worker]
    UI <--> SW
  end

  subgraph Cloud["Self-hosted backend"]
    API[Fastify API]
    W[Worker]
    DB[(PostgreSQL)]
    API --> DB
    W --> DB
  end

  subgraph External["External services"]
    GCal[Google Calendar]
    OC[OpenClaw]
  end

  SW --> GCal
  SW --> API
  W --> OC
```

### Browser extension

This is the user-facing product.

It includes:

- the popup
- the options/calendar workspace
- the blocked page
- the background service worker

Responsibilities:

- connect to Google Calendar
- read active events
- apply browser blocking rules
- manage breaks
- store lightweight local state
- capture ideas from the user
- display assistant state and idea results

### Backend API

This is the main server-side application.

Responsibilities:

- authenticate the extension with a backend session
- store users, ideas, sessions, reports, and telemetry
- expose API routes the extension can call
- manage the server-side state for the assistant system

### Backend worker

This is a separate background process from the API.

Responsibilities:

- find queued jobs
- send them to OpenClaw
- wait for results
- save completed reports
- mark jobs as completed, failed, or cancelled

This separation keeps long-running intelligence work out of the request/response cycle.

### OpenClaw connector

This is the server-side integration layer for your OpenClaw instance.

Responsibilities:

- check OpenClaw health
- create and reuse assistant sessions
- submit idea evaluation jobs
- cancel jobs
- support different transports such as `mock`, `http`, and `ssh`

### Database

The database stores long-lived product data such as:

- users
- backend sessions
- OpenClaw sessions
- ideas
- job records
- reports
- break telemetry
- future recommendation and analytics data

## How Window Works End To End

### Focus flow

```mermaid
flowchart TD
  A[User connects Google Calendar] --> B[Service worker syncs events]
  B --> C{Active event matches<br/>EventRule or keyword?}
  C -->|no| D[Browsing unrestricted]
  C -->|yes| E[Compute allowed domains<br/>+ global allowlist]
  E --> F{Blocking enabled<br/>and not paused?}
  F -->|no| D
  F -->|yes| G[Install DNR rules:<br/>block all → allow list]
  G --> H{User visits<br/>blocked site?}
  H -->|yes| I[Redirect to blocked page]
  H -->|no| J[Stay on allowed sites]
  I --> K{Start break?}
  K -->|yes| L[Clear rules for 5/10/15 min]
  L --> M[Alarm fires → re-apply rules]
  K -->|no| N[Return to allowed work]
  M --> G
```

### Break (snooze) flow

```mermaid
flowchart TD
  Start([User on blocked page]) --> Choose[Pick break duration]
  Choose --> Clear[clearAllRules — all sites reachable]
  Clear --> Alarm[Schedule ALARM_SNOOZE_END]
  Alarm --> Wait{Timer elapsed?}
  Wait -->|no| Browse[User browses freely]
  Browse --> Wait
  Wait -->|yes| Deactivate[deactivateSnooze]
  Deactivate --> Tick[Next calendar tick]
  Tick --> Still{Focus event<br/>still active?}
  Still -->|yes| Reblock[updateBlockingRules]
  Still -->|no| Open[Remain unrestricted]
```

### Idea capture flow

```mermaid
flowchart TD
  U[User submits idea in popup] --> Local[Save to chrome.storage<br/>idea outbox]
  Local --> Sync{Backend session<br/>available?}
  Sync -->|no| Queue[Retry on next sync]
  Sync -->|yes| POST[POST /v1/ideas]
  POST --> DB[(IdeaCapture + ResearchJob queued)]
  DB --> Worker[Worker claims job]
  Worker --> OC[OpenClaw evaluateIdea]
  OC --> Report[(IdeaReport saved)]
  Report --> Poll[Extension refreshes /v1/ideas]
  Poll --> UI[Popup shows summary + decision UI]
  Queue --> Sync
```

## Technology Stack

### Extension / frontend

- TypeScript
- React
- Vite
- Chrome Extension Manifest V3
- FullCalendar
- Chrome APIs:
  - `identity`
  - `storage`
  - `alarms`
  - `declarativeNetRequest`
  - `notifications`
  - `tabs`
  - `webNavigation`

### Backend

- TypeScript
- Node.js
- Fastify
- Prisma
- PostgreSQL
- Zod

### Assistant integration

- OpenClaw
- SSH or HTTP transport support
- background job orchestration through a dedicated worker

## Product Direction

Window starts as a calendar-aware focus tool.

Over time, it is meant to become a broader browser productivity system that can:

- capture and evaluate ideas
- understand distraction behavior
- surface recommendations
- support automation-oriented assistant workflows

The long-term direction is to bring useful OpenClaw-style assistant capabilities into the browser without forcing the user to leave their actual workflow.

## Current State

The current codebase already supports the focus product and includes the first major scaffolding for the OpenClaw-powered assistant system.

That means:

- focus blocking is already part of the product
- event-specific whitelist logic is already part of the product
- break handling is already part of the product
- idea capture and assistant orchestration are now part of the architecture
- real OpenClaw behavior depends on backend environment setup and the connected OpenClaw instance

## In One Sentence

Window is a browser extension that helps users stay focused during calendar-based work, manage event-specific allowed sites, and gradually evolve that focus system into a full browser-native productivity assistant powered by OpenClaw.

---

## Architecture Overview

Window is a **monorepo** with two runnable surfaces:

| Surface | Role | Default port / output |
|---------|------|------------------------|
| Chrome extension (`src/`) | UI, calendar sync, blocking, local state | Built to `dist/` |
| Backend API (`backend/src/server.ts`) | Auth, persistence, OpenClaw orchestration | `8787` |
| Backend worker (`backend/src/worker.ts`) | Async jobs (ideas, assistant tasks, learning packs) | N/A (poll loop) |

The extension talks to the backend over HTTP (`VITE_WINDOW_BACKEND_URL`, default `http://localhost:8787`). Focus blocking itself is **entirely local** via Chrome `declarativeNetRequest`; the backend is required for account sync, analytics upload, assistant features, and the learning quiz system.

### System context

```mermaid
flowchart TB
  subgraph Browser["Chrome browser"]
    Popup["Popup / Side panel"]
    Options["Options / Calendar workspace"]
    Blocked["Blocked page"]
    SW["Service worker<br/>(background)"]
    DNR["declarativeNetRequest"]
    Popup --> SW
    Options --> SW
    Blocked --> SW
    SW --> DNR
    SW --> GCal["Google Calendar API"]
  end

  subgraph Server["Window backend"]
    API["Fastify API<br/>:8787"]
    Worker["Job worker"]
    DB[(PostgreSQL)]
    API --> DB
    Worker --> DB
    Worker --> OC
  end

  SW -->|"REST /v1/*<br/>Bearer session"| API
  OC["OpenClaw instance<br/>(mock / http / ssh)"]
```

### Extension runtime

```mermaid
flowchart LR
  subgraph UI["React surfaces (Vite + CRX)"]
    P[popup/]
    O[options/]
    B[blocked/]
    S[sidepanel/]
    C[content/quizFab.ts]
  end

  subgraph BG["Service worker modules"]
    IDX[index.ts<br/>message hub + alarms]
    CAL[calendar.ts<br/>rule resolution]
    BLK[blocker.ts<br/>DNR rules]
    SNZ[snooze.ts<br/>breaks]
    PTS[points.ts + levels.ts]
    TQ[taskQueue.ts]
    ANA[analytics.ts]
    BE[backend.ts<br/>API client]
  end

  subgraph Shared["shared/"]
    ST[storage.ts]
    TYP[types.ts]
    ER[eventRules.ts]
  end

  P & O & B & S -->|chrome.runtime.sendMessage| IDX
  C -->|messages| IDX
  IDX --> CAL & BLK & SNZ & BE & ANA & TQ
  CAL & BLK & SNZ --> ST
  BE --> ST
```

### Focus blocking pipeline

Blocking runs on a periodic tick (`ALARM_TICK`, default every few minutes) and whenever calendar state changes. The service worker resolves **what is allowed right now**, then atomically replaces DNR dynamic rules.

```mermaid
flowchart TD
  Tick([ALARM_TICK or state change]) --> Snooze{Snooze active?}
  Snooze -->|yes| Clear[clearAllRules]
  Snooze -->|no| Fetch[Fetch calendar via OAuth]
  Fetch --> Resolve[calendar.resolveActiveState]
  Resolve --> Restricted{isRestricted?}
  Restricted -->|no| Clear
  Restricted -->|yes| Update[blocker.updateBlockingRules]
  Update --> BlockRule[BLOCK_ALL → blocked page]
  Update --> AllowRules[ALLOW per whitelisted domain]
  BlockRule --> DNR[(declarativeNetRequest)]
  AllowRules --> DNR
  DNR --> Visit{Navigation to host}
  Visit -->|not in allowlist| Redirect[Redirect to blocked UI]
  Visit -->|allowed| Pass[Request proceeds]
```

**DNR strategy** (see `src/background/blocker.ts`):

1. One catch-all **redirect** rule → extension blocked page (`BLOCK_ALL_RULE_ID`)
2. One **allow** rule per whitelisted hostname (higher priority wins)
3. **Session rules** for temporary domain unlocks and download allowances (separate ID range)

```mermaid
flowchart TD
  Request[Outgoing request] --> Session{Session rule:<br/>temp unlock or download?}
  Session -->|allow| OK[Allow]
  Session -->|no match| Dynamic{Dynamic rule}
  Dynamic --> Allow{Hostname in<br/>ALLOW rules?}
  Allow -->|yes| OK
  Allow -->|no| Block[BLOCK_ALL redirect]
  Block --> Page[blocked/index.html]
```

### Rule resolution

For each **currently active** calendar event, Window picks domains in this order:

```mermaid
flowchart TD
  Start([Active calendar event]) --> Exact{Exact EventRule<br/>title match?}
  Exact -->|yes, empty domains| Unrestricted[mode: unrestricted<br/>no blocking]
  Exact -->|yes, has domains| AllowExact[mode: allow<br/>event domains]
  Exact -->|no| KW{keywordAutoMatchEnabled<br/>AND keyword hit?}
  KW -->|yes| AllowKW[mode: allow<br/>keyword domains]
  KW -->|no| NoRule[No rule for event]
  NoRule --> Unrestricted2[Browsing unrestricted<br/>for that event]

  AllowExact --> Multi{Multiple active<br/>events with rules?}
  AllowKW --> Multi
  Multi -->|yes| Intersect[Intersect domain lists<br/>across events]
  Multi -->|no| Single[Use that event's domains]
  Intersect --> Global[+ global allowlist<br/>e.g. accounts.google.com]
  Single --> Global
  Global --> Flags{enableBlocking +<br/>feature flag +<br/>not daily pause?}
  Flags -->|yes| Restrict[isRestricted = true]
  Flags -->|no| Open[isRestricted = false]
```

Important behaviors:

- **Exact rules win** over keyword rules unless the exact rule is a redundant copy of a keyword rule (same domains, no tag metadata) — then the keyword source is preferred.
- An exact rule with **zero domains** means “track this event but do not block” (`mode: unrestricted`).
- Overlapping focused events use **domain intersection** (strictest common allowlist).
- **Extended task assignments** and **launch targets** can add extra allowed hosts for linked workflows.

### Assistant & idea evaluation

Long-running AI work never blocks the API request path. The worker claims jobs and calls OpenClaw.

```mermaid
flowchart TD
  subgraph Extension
    Submit[User submits idea or assistant task]
    Outbox[Local outbox in chrome.storage]
    Refresh[refreshAssistantState / syncIdeaOutbox]
  end

  subgraph API["Fastify API"]
    Create[POST /v1/ideas or /v1/assistant-tasks]
    Return[Return ids + queued status]
  end

  subgraph Worker["backend worker loop"]
    Poll[Sleep WORKER_POLL_INTERVAL_MS]
    Claim[Claim next ResearchJob,<br/>AssistantTaskJob, or LearningJob]
    Run[Call OpenClaw connector]
    Save[Persist report or mark failed]
    Poll --> Claim --> Run --> Save --> Poll
  end

  Submit --> Outbox --> Create --> Return
  Create --> DB[(PostgreSQL)]
  DB --> Claim
  Run --> OC[OpenClaw mock/http/ssh]
  Save --> DB
  DB --> Refresh
```

### Worker job dispatch

Each poll cycle runs three batch processors in order (see `backend/src/worker.ts`):

```mermaid
flowchart LR
  Loop([Worker loop]) --> R[processResearchJobsBatch]
  R --> A[processAssistantTasksBatch]
  A --> L[processLearningJobsBatch]
  L --> Delay{Any job processed?}
  Delay -->|yes| Fast[Sleep 500ms]
  Delay -->|no| Slow[Sleep WORKER_POLL_INTERVAL_MS]
  Fast --> Loop
  Slow --> Loop
```

### Authentication & account sync

```mermaid
flowchart TD
  SignIn[User signs in via popup] --> GToken[chrome.identity.getAuthToken]
  GToken --> Exchange[POST /v1/auth/google/exchange]
  Exchange --> Session[BackendSession token stored locally]
  Session --> Me[GET /v1/auth/me]
  Me --> Snapshot[Optional PUT/GET /v1/account/snapshot<br/>for cross-device settings]
  Snapshot --> Use[Authenticated API calls<br/>Authorization: Bearer]
  Logout[Sign out] --> Revoke[POST /v1/auth/logout + clear storage]
```

Job types processed by `backend/src/lib/jobs.ts`:

| Processor | Queue entity | Output |
|-----------|--------------|--------|
| `processResearchJobsBatch` | `ResearchJob` → `IdeaCapture` | `IdeaReport` (viability, risks, next steps, …) |
| `processAssistantTasksBatch` | `AssistantTaskJob` | `AssistantTaskResult` |
| `processLearningJobsBatch` | `LearningJob` | Quiz packs, ingestion, regeneration |

### Learning / quiz subsystem

When the learning feature flag is on, users pick topics from a catalog (or create custom topics). Canonical quiz JSON lives under `backend/data/learning/quizzes-cleaned/`. The backend serves spaced-repetition prompts; a content script (`src/content/quizFab.ts`) can surface quizzes on allowed pages during focus.

```mermaid
flowchart TD
  Onboard[User selects topics<br/>POST /v1/learning/user-topics] --> Ready{Quiz pack ready?}
  Ready -->|imported corpus| Next[GET /v1/learning/review/next]
  Ready -->|regenerate| Job[LearningJob queued → worker]
  Job --> Ready
  Next --> Fab[quizFab on allowed tab]
  Fab --> Answer[POST /v1/learning/answers]
  Answer --> Schedule[Update UserQuizProgress<br/>dueAt / ease / streak]
  Schedule --> Points[Award points in extension]
  Points --> Next
```

### Core data model (simplified)

```mermaid
erDiagram
  User ||--o{ BackendSession : has
  User ||--o{ IdeaCapture : captures
  User ||--o{ AssistantTask : creates
  User ||--o{ OpenClawConnection : owns
  User ||--o{ FocusSession : tracks
  User ||--o{ UserLearningTopic : studies

  IdeaCapture ||--o| ResearchJob : queues
  IdeaCapture ||--o| IdeaReport : produces
  IdeaCapture }o--|| OpenClawSession : uses

  AssistantTask ||--o| AssistantTaskJob : queues
  AssistantTask ||--o| AssistantTaskResult : produces

  OpenClawConnection ||--o{ OpenClawSession : hosts

  LearningTopic ||--o{ QuizPack : contains
  QuizPack ||--o{ QuizPackVersion : versions
  QuizPackVersion ||--o{ QuizQuestion : has
  User ||--o{ UserQuizProgress : reviews
```

Full schema: `backend/prisma/schema.prisma`.

---

## Quick Start

### Local development flow

```mermaid
flowchart TD
  Clone[Clone repo] --> ExtDeps[npm install at root]
  ExtDeps --> Build[npm run build]
  Build --> Load[Load dist/ in chrome://extensions]
  Clone --> BeDeps[cd backend && npm install]
  BeDeps --> Env[Create backend/.env<br/>DATABASE_URL + OPENCLAW_*]
  Env --> Migrate[npx prisma migrate dev]
  Migrate --> API[npm run dev]
  Migrate --> Worker[npm run worker]
  API --> Full[Extension + API + worker running]
  Worker --> Full
  Load --> Full
  Full --> Test[npm test]
```

### Install the Extension (Development)

```bash
# 1. Install dependencies
npm install

# 2. Build the extension
npm run build

# 3. Load in Chrome
# - Open chrome://extensions
# - Enable "Developer mode"
# - Click "Load unpacked"
# - Select the `dist/` folder
```

### Run the Backend

```bash
cd backend
npm install

# Set environment variables (see Configuration section)
export DATABASE_URL="postgresql://..."
export OPENCLAW_TRANSPORT=mock

# Start the API server
npm run dev

# In another terminal, start the worker
npm run worker
```

### Run Tests

```bash
npm test
```

---

## Installation

### Chrome Web Store (Production)

Window is not yet published to the Chrome Web Store. For now, install from source as shown above.

### Side Panel

Window supports Chrome's Side Panel API. Right-click the extension icon and select "Show in Side Panel" for a persistent workspace.

---

## Project Structure

```
window-extension/
├── manifest.json                 # MV3 manifest (permissions, OAuth, entrypoints)
├── vite.config.ts                # Extension build (@crxjs/vite-plugin)
├── vitest.config.ts              # Extension unit tests
├── src/
│   ├── background/               # Service worker
│   │   ├── index.ts              # Alarms, tabs, messages, orchestration
│   │   ├── calendar.ts           # GCal sync + resolveActiveState
│   │   ├── blocker.ts            # declarativeNetRequest dynamic/session rules
│   │   ├── snooze.ts             # Timed breaks (clears rules while active)
│   │   ├── backend.ts            # REST client, auth, sync outboxes
│   │   ├── analytics.ts          # Focus/activity session tracking
│   │   ├── points.ts / levels.ts # Gamification
│   │   ├── taskQueue.ts          # Window task queue + carryover
│   │   ├── telemetry.ts          # Break visit batching
│   │   └── demoSeed.ts           # Demo data helper
│   ├── popup/                    # Toolbar popup (React)
│   ├── options/                  # Full calendar workspace (FullCalendar)
│   ├── blocked/                  # Redirect target when a site is blocked
│   ├── sidepanel/                # Persistent side panel surface
│   ├── content/quizFab.ts        # In-page quiz FAB during learning mode
│   └── shared/                   # Types, storage, rules, UI components
│       ├── storage.ts            # chrome.storage.local wrapper + defaults
│       ├── types.ts              # Shared TypeScript contracts
│       ├── eventRules.ts         # CRUD for event/keyword rules
│       ├── learning.ts           # Feature gates + taxonomy helpers
│       └── components/
├── tests/                        # Vitest (extension logic)
├── backend/
│   ├── src/
│   │   ├── server.ts             # HTTP listen
│   │   ├── app.ts                # Route definitions (/v1/*)
│   │   ├── worker.ts             # Job poll loop
│   │   ├── env.ts                # Zod-validated environment
│   │   └── lib/
│   │       ├── auth.ts
│   │       ├── jobs.ts
│   │       ├── learning.ts
│   │       ├── serializers.ts
│   │       └── openclaw/         # Connector transports (mock/http/ssh)
│   ├── prisma/schema.prisma
│   ├── data/learning/quizzes-cleaned/   # Canonical quiz JSON banks
│   └── scripts/                  # Quiz authoring, import, validation
├── docs/                         # Specs, investor deck, textbook manifest
├── ops/oracle/                   # systemd units for production deploy
└── promo-assets/                 # Marketing screenshots
```

---

## Configuration

### Environment Variables (Backend)

Create a `.env` file in `backend/`:

```env
# Database (required)
DATABASE_URL="postgresql://user:pass@localhost:5432/window?schema=public"

# Server
PORT=8787

# OpenClaw connector (backend/src/env.ts)
OPENCLAW_TRANSPORT=mock          # mock | http | ssh
OPENCLAW_API_TOKEN=""
OPENCLAW_HTTP_BASE_URL=""
OPENCLAW_REMOTE_BASE_URL="http://127.0.0.1:3000"
OPENCLAW_SSH_HOST=""
OPENCLAW_SSH_USER=""
OPENCLAW_SSH_KEY_PATH=""
OPENCLAW_FETCH_MODE=permissive   # permissive | strict
OPENCLAW_ALLOWED_HOST_SUFFIXES="" # comma-separated when strict
OPENCLAW_MOCK_LATENCY_MS=2500

# Worker
WORKER_POLL_INTERVAL_MS=5000

# Google token verification (optional override)
GOOGLE_TOKENINFO_URL="https://www.googleapis.com/oauth2/v3/tokeninfo"
```

Extension build-time override for API URL:

```bash
VITE_WINDOW_BACKEND_URL=http://localhost:8787 npm run build
```

### Chrome OAuth

The extension uses Google OAuth for calendar access. Update `manifest.json` with your own client ID:

```json
"oauth2": {
  "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
  "scopes": [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/calendar.readonly"
  ]
}
```

### Prisma Setup

```bash
cd backend
npx prisma migrate dev
npx prisma generate
```

---

## API Reference

All routes are under `/v1` unless noted. Authenticated routes expect `Authorization: Bearer <backend-session-token>`.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/healthz` | GET | Liveness check |
| `/v1/auth/google/exchange` | POST | Exchange Google access token for backend session |
| `/v1/auth/logout` | POST | Revoke backend session |
| `/v1/auth/me` | GET | Current user profile |
| `/v1/account/snapshot` | GET/PUT | Cross-device settings blob + revision |
| `/v1/connectors` | GET | List OpenClaw connectors for user |
| `/v1/connectors/select` | POST | Set active connector |
| `/v1/openclaw/settings` | GET/PUT | Personal connector URL + token |
| `/v1/openclaw/settings/test` | POST | Validate connector credentials |
| `/v1/openclaw/status` | GET | Health / connectivity |
| `/v1/openclaw/sessions` | GET/POST | List or create assistant sessions |
| `/v1/openclaw/jobs/:id/cancel` | POST | Cancel remote job |
| `/v1/ideas` | GET/POST | List or submit ideas |
| `/v1/ideas/:id` | GET | Idea detail + report |
| `/v1/ideas/:id/decision` | POST | keep / discard |
| `/v1/ideas/:id/retry` | POST | Re-queue failed idea |
| `/v1/assistant-tasks` | GET/POST | List or create tasks |
| `/v1/assistant-tasks/:id/cancel` | POST | Cancel task |
| `/v1/break-visits/batch` | POST | Upload break telemetry |
| `/v1/activity-sessions/batch` | POST | Upload focus + activity sessions |
| `/v1/analytics/*` | GET/POST | Interests, summary, tags, overrides |
| `/v1/learning/*` | GET/POST | Taxonomy, topics, review, answers |

---

## Core Concepts

### EventRule vs KeywordRule

| Concept | Match key | Storage | Typical use |
|---------|-----------|---------|-------------|
| **EventRule** | Exact calendar event title | `eventRules` in `chrome.storage.local` | Per-meeting allowlists |
| **KeywordRule** | Substring in title (when `keywordAutoMatchEnabled`) | `keywordRules` | Reusable templates (“standup”, “deep work”) |

```mermaid
flowchart LR
  Title[Calendar event title] --> Exact[EventRule table]
  Title --> Key[Keyword rules scan]
  Exact --> Winner[Resolved allowlist]
  Key --> Winner
```

### Window task queue

Calendar events can spawn **Tasks** in the local queue (`taskQueue.ts`): active work items with scheduled start/end, carryover across days, points on completion, and optional snooze limits. This is separate from **AssistantTask** records on the backend.

```mermaid
flowchart TD
  Event[Calendar event ends incomplete] --> Carry[status: carryover]
  Carry --> Later[User completes on a later day]
  Later --> Points[points.ts awards score<br/>with carryover multiplier]
```

### Connectors & OpenClaw sessions

- **OpenClawConnection** — stored credentials + transport (`mock`, `http`, `ssh`) per user.
- **OpenClawSession** — conversation context on the remote assistant; ideas and assistant tasks attach to a session when evaluated.
- The extension UI exposes instance settings; the worker resolves the user’s selected connector before calling `openClawConnector`.

### Analytics model

While a focus event is active, `analytics.ts` classifies tab activity into `aligned`, `supportive`, `distracted`, `away`, or `break`, rolls up minutes per **TaskTag**, and batches **FocusSession** + **ActivitySession** records to `/v1/activity-sessions/batch`.

```mermaid
flowchart TD
  Tab[Tab URL changes] --> Classify[Classify vs tag domains]
  Classify --> Heartbeat[Periodic heartbeat]
  Heartbeat --> Batch[Queue local records]
  Batch --> Upload[POST activity-sessions/batch]
  Upload --> Agg[(DailyAnalyticsAggregate)]
```

### Feature flags

Defined in `Settings.featureFlags` (`src/shared/constants.ts` defaults):

| Flag | Controls |
|------|----------|
| `blocking` | Calendar-based DNR blocking |
| `routines` | Task queue / carryover routines |
| `learning` | Quiz FAB + backend learning APIs |

### Local vs server state

```mermaid
flowchart TB
  subgraph Local["chrome.storage.local"]
    Rules[event + keyword rules]
    Cal[calendar cache]
    Ideas[idea outbox]
    Stats[points + analytics queues]
  end

  subgraph Server["PostgreSQL via API"]
    User[User + BackendSession]
    Remote[Ideas, tasks, reports]
    Learn[Quiz progress]
  end

  Local <-->|snapshot + sync outboxes| Server
```

---

## Development

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server for extension HMR |
| `npm run dev:popup` / `dev:ui` | Preview popup/options without full CRX load |
| `npm run build` | Production extension → `dist/` |
| `npm test` | Extension Vitest suite |
| `npm run typecheck` | Extension TypeScript |
| `cd backend && npm run dev` | API with `tsx watch` |
| `cd backend && npm run worker` | Job worker |
| `cd backend && npm run import:learning-quizzes` | Import JSON banks into DB |

Production deploy units live in `ops/oracle/` (`window-api.service`, `window-db-backup.service`).

---

## Further reading

- `docs/window-popup-surface-spec.md` — popup UX specification
- `window-popup-surface-spec.md` — blocking page / surface notes (repo root)
- `docs/window-investor-deck.md` — product narrative
