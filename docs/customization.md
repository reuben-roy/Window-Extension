# Customization guide

Window can become a general product if configuration is separated from the original user's defaults. Treat each customization surface as either user-level, deployment-level, or platform-level.

## User-level customization

These settings belong in extension UI or synced user state:

| Surface | Examples |
| --- | --- |
| Calendar rules | Event title rules, keyword fallbacks, allowed domains, default behavior when no event matches |
| Break behavior | Preset durations, cooldowns, maximum breaks per focus block |
| Task library | Built-in tasks, custom tasks, point values, completion prompts |
| Learning topics | Selected topics, chapter progress, review cadence, difficulty preference |
| Assistant preferences | Selected connector, notification mode, focus context, model/task preferences |
| Profiles | Work, study, personal, exam mode, job-search mode |

Do not hardcode one user's event names, websites, task categories, or learning topics into shared logic. Seed them as defaults that a user can replace.

## Deployment-level customization

These settings belong in backend env vars, database rows, or deployment docs:

| Surface | Current home |
| --- | --- |
| PostgreSQL connection | `DATABASE_URL` |
| API port | `PORT` |
| Google identity token verification | `GOOGLE_TOKENINFO_URL` |
| OpenClaw transport | `OPENCLAW_TRANSPORT` |
| OpenClaw SSH/HTTP credentials | `OPENCLAW_*` env vars or `OpenClawConnection` rows |
| Strict fetch allowlist | `OPENCLAW_FETCH_MODE`, `OPENCLAW_ALLOWED_HOST_SUFFIXES` |
| Worker cadence | `WORKER_POLL_INTERVAL_MS` |

For a multi-user deployment, prefer per-user connector rows over global OpenClaw credentials. Global env vars are useful for a single hosted instance, but they do not model user-specific assistant backends.

## Platform-level extension points

Use clear interfaces around these features before adding more providers:

- Calendar providers: Google Calendar today; future providers should map into the same event/rule model.
- Assistant connectors: OpenClaw today; future providers should implement the same task/session lifecycle.
- Learning content: quiz banks today; future sources should produce validated topic, chapter, quiz, and artifact records.
- Blocking policy: DNR allowlist logic today; future modes should still resolve from a testable rule model.

## Productizing checklist

Before presenting Window as configurable for everyone:

- Move personal defaults into seed data or onboarding templates.
- Document every required backend environment variable.
- Make connector setup a UI flow or a clear deployment guide.
- Add import/export for event rules and profiles.
- Keep browser permissions explicit in onboarding copy.
- Add a migration path for local-only users to backend-sync users.
- Add tests for rule resolution, backend sync, connector failure states, and learning imports.

## Security boundaries

- Extension local state is not a secret store.
- Backend session tokens should be hashed server-side and short enough to rotate safely.
- OpenClaw tokens and SSH keys should never be sent to the extension.
- Strict fetch mode should be used for hosted deployments that execute assistant jobs from user-supplied URLs.
- Analytics and telemetry tables should avoid collecting raw page content unless the user has clearly opted in.
