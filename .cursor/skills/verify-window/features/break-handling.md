# Break handling

Break handling lets a user pause blocking for 5, 10, or 15 minutes and resume early. Starting a break clears the blocking rules and shows a countdown; ending it (or letting it expire) restores the pre-break restriction state. Both the popup and the blocked page offer the same control.

## Sub-features

- `break-start-popup` starts a break from the popup `Take a break` button.
- `break-countdown` shows the remaining break time while a break is active.
- `break-end-early` resumes blocking before the timer expires.
- `break-start-blocked` starts a break from the blocked page break-timer card (`5 min` / `10 min` / `15 min` duration buttons plus `Start N-minute break`).

## How to get to it (user POV)

- In the popup Focus section, choose `Take a break` (uses the configured break length, default 5 minutes).
- On the blocked page, pick a duration and choose `Start N-minute break`; while active, choose `Resume blocking now`.

## Driving it with control-window

Preconditions:

- `control-window doctor` passes and the run launched via `control-window launch`.
- No break is active at start; the popup snapshot contains `Take a break` (proves the entry point exists in this build).

- **Start break.** Drive the real popup button. Run `control-window drive break --out "$VERIFY_OUT/break"`. The command clicks the `Take a break` button, waits for `Break active` text, and writes `before.png`, `after.png`, `snapshot.txt`, and `state.json`.
- **Confirm background state.** Read the second view. `state.json` shows `snoozeState.active: true` with a future `expiresAt`, and `dnrDynamicRules` is `[]` (starting a break clears blocking rules — the observable side effect).
- **End break.** Restore the pre-break state. Run `control-window drive end-break`. A follow-up `control-window drive state` shows `snoozeState.active: false`.
- **Proof.** The `--out` directory holds the action (`before.png` with `Take a break` visible), the resulting state (`after.png` with `Break active` plus countdown), and the stored value (`state.json` snooze block). All artifacts record the `break-start-popup` entry point.
- **Blocked-page entry.** Repeat the same flow from the blocked surface with `control-window drive snapshot "blocked?blocked=example.com"` to confirm the break-timer card is present; drive its `Start N-minute break` button only if the popup entry already passed in this run.

## Gotchas

- The popup break button label is fixed (`Take a break`); the duration comes from settings (`breakDurationMinutes`, default 5). The blocked page instead offers explicit `5 min` / `10 min` / `15 min` choices.
- `clearAllRules` on break start is expected even when no block was active; an empty `dnrDynamicRules` list alone does not prove a block existed.
- Break expiry relies on the `ALARM_SNOOZE_END` alarm; a proof run must end the break explicitly (`end-break`) rather than waiting out the timer.
- Never leave a break active at the end of a run; a stray active break makes the next run's baseline (and the user's, on a shared profile — which this skill forbids) silently unrestricted.
