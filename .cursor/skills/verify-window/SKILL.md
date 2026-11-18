---
name: verify-window
description: "Drive and verify the Window Chrome extension (MV3, React popup + blocked page + options workspaces) in a dedicated headless Chrome over CDP: launch it, run doctor, exercise one mapped user-facing feature, and capture proof. Use whenever Window behavior needs proving rather than asserting."
---

# Verify Window

Window is a Manifest V3 Chrome extension (`manifest.json`, `name: "Window"`).
Source lives in `src/` (`popup/`, `blocked/`, `options/`, `background/`, `sidepanel/`, `content/`);
the shippable build is `dist/` (produced by `npm run build` at the repo root).
The backend in `backend/` (Postgres + `OPENCLAW_TRANSPORT=mock`) is optional:
extension-only features verify without it.

The harness is `scripts/control-window` (shell; executable), which wraps
`scripts/cdp-drive.mjs` (Node 22+, zero dependencies, CDP over the
remote-debugging port). Never hardcode the extension ID: every run resolves it
at runtime (`chrome.runtime.getManifest().name === "Window"`) and exports it
as `WINDOW_EXT_ID`.

Feature map: `features/README.md` (index, conventions) plus one file per
user-facing feature (`focus-blocking`, `break-handling`, `event-rules`,
`temporary-unlock`, `learning-review`). Read the index first, then the one
feature file you are proving. Each file answers: what it is, how a user
reaches it, the exact drive commands, and what observable state proves it.

## Launch

One verification instance per run, never the user's daily browser:

```sh
cd /Users/reuben/github/hobby/Window-Extension
npm run build   # dist/ must be fresh; launch refuses to start without dist/src/popup
export VERIFY_PORT=19222 VERIFY_PROFILE=/tmp/window-verify-profile
eval "$(./.cursor/skills/verify-window/scripts/control-window launch)"
# prints WINDOW_EXT_ID=... VERIFY_PORT=... VERIFY_PROFILE=... — eval to export
export VERIFY_OUT=/tmp/window-verify-evidence
```

`launch` starts headless Chrome (`--user-data-dir=$VERIFY_PROFILE`,
`--remote-debugging-port=$VERIFY_PORT`, `--load-extension=<repo>/dist`),
waits for the debugger port, resolves the extension ID from the live service
worker (falling back to the profile Preferences), and refuses to start when a
run-owned Chrome is already alive. Ready means: the launch command printed
`WINDOW_EXT_ID` without `FAIL`.

`$VERIFY_OUT` is yours to choose; proof artifacts land in its subdirectories.
Defaults: `VERIFY_PORT=19222`, `VERIFY_PROFILE=/tmp/window-verify-profile`.
A second instance needs a different port AND profile; when in doubt, do not
start one — report the busy instance instead.

Backend-gated paths (sync, idea evaluation, quiz packs) additionally need
`backend/.env` `DATABASE_URL` plus `OPENCLAW_TRANSPORT=mock` and
`control-window doctor --backend` passing. Extension-only features
(status, break, rules, unlock, review hero) verify without it.

## Doctor

Read-only. Run it first whenever anything looks off, and before every drive
after a failure:

```sh
./.cursor/skills/verify-window/scripts/control-window doctor [--backend]
```

It checks, in order: a run-owned Chrome is alive (`$VERIFY_PROFILE/chrome.pid`,
kill by pid only); the debugger port answers; `WINDOW_EXT_ID` resolves to the
live Window service worker on that port (catches stale env / wrong instance);
with `--backend`, the backend `/api/health` answers. Any failure prints
`FAIL: ...` — fix the named cause, do not drive around it.

## Drive

All interaction goes through `control-window drive` (CDP; no coordinates, no
tab order — buttons by text, surfaces by name):

```sh
control-window drive snapshot popup --out "$VERIFY_OUT/status"
control-window drive snapshot "blocked?blocked=example.com" --out "$VERIFY_OUT/blocked"
control-window drive snapshot "options#learning" --out "$VERIFY_OUT/learning"
control-window drive snapshot "options#calendar" --out "$VERIFY_OUT/rules"
control-window drive state --out "$VERIFY_OUT/status"   # GET_STATE + DNR rules -> state.json
control-window drive break --out "$VERIFY_OUT/break"    # clicks "Take a break", waits for "Break active"
control-window drive spend --out "$VERIFY_OUT/unlock"  # clicks "Spend <N> points", waits for "Unlock purchased"
control-window drive end-break                           # restores pre-break state
control-window drive click popup --button "<text>" --expect "<text>" --out DIR
```

Surface names are `popup`, `blocked?...`, `options#<tab>` (`learning` is the
default tab; `calendar`, `analytics`, `settings` are the others) and open as
full tabs — the React tree is identical to the popup/blocked rendering and CDP
can observe it. `snapshot` writes `snapshot.txt` (body text), `ax.txt`
(headings/buttons/links/inputs outline), and `page.png`. `click` additionally
writes `before.png`/`before.txt` (the action) and `after.png` plus `state.json`
(the resulting state). `state` writes `state.json`: `snoozeState`,
`calendarState` (restriction, allowed domains, active event/rule), a
`learningState` summary, and the live `dnrDynamicRules` IDs.

Follow the feature file's recipe verbatim: it names the exact surface, button
text, expected text, and second-view read for that feature. Exercise the real
user path (click the button, submit the form) — never write
`chrome.storage` or call background setters directly, and never assert from a
first paint (`Loading…` text means wait for the harness wait-loop, not failure).

## Evidence

One feature per run is a complete proof. For the driven feature capture:

1. The action and the resulting state, not just the final screen
   (`before.png` + `after.png`, or snapshot text before/after a save).
2. A read-only second view of the stored value (`state.json` via `drive
   state`: snooze block, points total, `calendarState.allowedDomains`,
   `learningState.userTopics`/`reviewQueue`) alongside what the UI rendered.
3. Side effects where blocking is involved: `dnrDynamicRules` in `state.json`
   (break start clears rules; break end restores the pre-break set).

Write artifacts under `$VERIFY_OUT/<feature>/` and record the feature ID and
entry point used with them. Mocks only where a production boundary already
isolates the external system (backend `OPENCLAW_TRANSPORT=mock`); a dry-run or
test mode proves nothing until you observe what it skipped (files, network,
refs). Report an unreachable path with the attempted command and the unmet
precondition (e.g. no live calendar event, zero quiz packs) — never report it
as verified through a different path.

## Cleanup

```sh
./.cursor/skills/verify-window/scripts/control-window cleanup
```

Kills only the Chrome pid this run started (never by process name) and removes
scratch state (`chrome.pid`, warmup tabs). Proof artifacts under `$VERIFY_OUT`
survive — after cleanup, confirm the evidence still exists at the named
location; a cleanup that eats the proof fails this skill. Also restore mutated
app state first: `drive end-break` after any break run, remove any
`verify-<RUN_ID>`-suffixed topic after a learning run. Run cleanup after every
failed iteration too, so broken attempts do not strand processes or ports.

## Helpers

- `scripts/control-window` — `launch | doctor [--backend] | drive <cmd> | cleanup`.
  Shown in full above; the only entry point a run needs.
- `scripts/cdp-drive.mjs` — the CDP driver `control-window` wraps. Executable,
  zero dependencies. Its subcommands are `resolve | snapshot <surface> |
  state | click <surface> --button T [--expect T] | end-break`, each taking
  `--port`, `--ext-id`, `--out`. Prefer `control-window drive` (it supplies
  port/ID and the `break`/`spend` shorthands); call `cdp-drive.mjs` directly
  only to debug the harness itself.
- `features/README.md` — baseline preconditions, driving conventions, and the
  per-feature contract. The map is the maintained verification source; a proof
  that drives one convenient entry point is incomplete when the map lists
  others — say which entry point you proved and which remain.
