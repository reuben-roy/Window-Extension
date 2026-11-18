# Window — verification skill

This directory is the maintained source for verifying the user-facing behavior of Window. Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Repo checkout builds cleanly (`npm run build` at the repo root, `dist/` produced).
- Extension under test is the local `dist/` build, loaded unpacked into a dedicated Chrome for Testing instance (never the user's daily browser).
- Each run uses a disposable Chrome profile (`VERIFY_PROFILE`, default `/tmp/window-verify-profile`) and its own remote-debugging port (`VERIFY_PORT`, default `19222`).
- Discover the extension ID at runtime via `control-window launch` (it resolves `chrome.runtime.getManifest().name === "Window"`); never hardcode an ID.
- Backend is optional. Extension-only features (status, break, rules, unlock, review hero) verify without it. Anything requiring sync, idea evaluation, or quiz packs additionally needs Postgres (`backend/.env` `DATABASE_URL`) and `OPENCLAW_TRANSPORT=mock`, plus `control-window doctor --backend` passing.
- Never drive an instance that was not started by this verification run (doctor enforces pid ownership).

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Open extension surfaces as full tabs (`chrome-extension://<EXT_ID>/src/<surface>/index.html`), never as real popups; the React tree is identical and CDP can observe it.
- Prefer accessible names (button text, headings) over CSS selectors or coordinates.
- Treat every command as literal. Keep quoted names and flags unchanged.
- Run browser actions through `control-window drive ...` (CDP via bundled `scripts/cdp-drive.mjs`, zero dependencies beyond node).
- Run read-only checks through `control-window doctor`.
- Restore break state after a mutation (`END_SNOOZE`). Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes a text snapshot and a screenshot with the app identity visible (`Window` header / `Focus checkpoint` / workspace tabs).
- Mutation proof includes a read-only second view of the stored value (`GET_STATE` before and after, plus DNR rule listing where blocking is involved).
- Record the feature ID and entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with <harness>` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Focus blocking](./focus-blocking.md) covers popup status, the blocked page, and the allowlist display.
- [Break handling](./break-handling.md) covers starting and ending a break from the popup and the blocked page.
- [Event rules](./event-rules.md) covers calendar-workspace rule management (event and keyword rules).
- [Temporary unlock](./temporary-unlock.md) covers spending points on the blocked page.
- [Learning review](./learning-review.md) covers study topics and the review queue from the options workspace and popup hero.
