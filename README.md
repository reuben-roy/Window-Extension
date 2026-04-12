# Window

Window is a browser-based focus and productivity assistant.

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

1. The user connects Google Calendar
2. Window syncs current calendar events
3. Window resolves the active Event Rule or keyword fallback
4. Window applies browser blocking rules locally
5. The user either stays focused or starts a timed break

### Idea capture flow

1. The user writes an idea in the popup
2. The extension stores it locally first
3. The extension sends it to the backend
4. The backend stores the idea and creates a queued job
5. The worker picks up the job
6. The worker sends it to OpenClaw
7. The result is saved as a report
8. The extension shows the finished result later

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
