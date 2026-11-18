# Focus blocking

Focus blocking shows whether browsing is currently restricted and, when a site is stopped, explains why and what is still allowed. The popup carries a status pill (`Focus active` / `On break` / `Open browsing`); a blocked navigation lands on the blocked page naming the stopped host and listing the domains allowed right now.

## Sub-features

- `blocking-status` shows the current restriction state in the popup header.
- `blocking-now-next` shows the live event (`Now`) and the upcoming one (`Next up`) in the popup Focus section.
- `blocking-redirect` sends a disallowed navigation to the blocked page instead of the site.
- `blocking-allowlist` lists the domains allowed right now on the blocked page.

## How to get to it (user POV)

- Open the toolbar popup and read the status pill and the Focus section.
- Visit a disallowed site while a focus block is active and land on the blocked page.
- Open the blocked page directly at `src/blocked/index.html?blocked=<host>` to inspect its layout without an active block.

## Driving it with control-window

Preconditions:

- `control-window doctor` passes and the run launched via `control-window launch` (extension ID exported as `WINDOW_EXT_ID`).
- No break is active (`GET_STATE` shows `snoozeState.active: false`); end one with `control-window drive end-break` if needed.
- Full `blocking-redirect` proof additionally needs a connected Google Calendar and a live event with a rule; without that, only `blocking-status` (expect `Open browsing`) and the direct blocked-page layout are verifiable — report the redirect path as skipped with the unmet precondition.

- **Popup status.** Open the popup surface. Run `control-window drive snapshot popup --out "$VERIFY_OUT/status"`. The text snapshot contains `Window`, a status pill (`Focus active`, `On break`, or `Open browsing`), and a `Focus` section with `Now` and `Next up` rows.
- **Blocked layout.** Open the blocked page for a named host. Run `control-window drive snapshot "blocked?blocked=example.com" --out "$VERIFY_OUT/blocked"`. The snapshot contains `Focus checkpoint`, `Stay in the zone`, `example.com is paused while your focus block is active.`, and an `ALLOWED RIGHT NOW` region.
- **Allowlist second view.** Confirm the domain list twice. Run `control-window drive state --out "$VERIFY_OUT/blocked"` and compare `calendarState.allowedDomains` in `state.json` with the domains rendered in the snapshot; both come from the same background state read.
- **Proof.** Capture the populated state. The `--out` directory holds `snapshot.txt`, `page.png`, and `state.json` for each surface; all three identify Window and the exercised entry point.

## Gotchas

- Without a connected calendar the pill reads `Open browsing` and `Now` reads `No focus block live`; that is the correct disconnected state, not a failure.
- The blocked page always renders when opened directly, even with no block active — direct open proves layout only, never the redirect.
- `GET_STATE` wakes the service worker on first call; allow the wait loop in `drive` to finish instead of asserting on the first read.
