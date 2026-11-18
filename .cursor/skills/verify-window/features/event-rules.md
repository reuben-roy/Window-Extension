# Event rules

Event rules decide which domains stay reachable during a calendar event. Exact event-title rules win over keyword rules (substring matches used when keyword auto-match is on); overlapping focused events intersect their domain lists. The calendar workspace in the options page is where a user browses events and manages these rules instead of editing a settings form.

## Sub-features

- `rules-workspace` opens the calendar workspace from the popup (`Calendar workspace` button) or the options page `Calendar` tab.
- `rules-keyword-create` saves a keyword rule (keyword plus allowed domains, optional tag).
- `rules-event-edit` edits or removes the rule attached to a specific event.
- `rules-resolution` shows which rule source is active for the current event (`Event rule: <name>` in the popup Focus section).

## How to get to it (user POV)

- In the popup, choose `Calendar workspace`.
- In the options page, choose the `Calendar` tab.
- In the calendar workspace, use the keyword-rule form and the per-event rule controls.

## Driving it with control-window

Preconditions:

- `control-window doctor` passes and the run launched via `control-window launch`.
- Reading rules needs no calendar connection (rules live in local storage); resolving against live events needs a connected calendar with events — report that path as skipped when disconnected.

- **Open workspace.** Open the calendar tab directly. Run `control-window drive snapshot "options#calendar" --out "$VERIFY_OUT/rules"`. The snapshot contains the `Calendar` tab and the workspace event list (or the disconnected notice when no calendar is linked — still a valid layout proof).
- **Inspect stored rules.** Read the second view. Run `control-window drive state --out "$VERIFY_OUT/rules"` and confirm `state.json` round-trips through `GET_STATE` without error; rule contents live alongside calendar state in the same response.
- **Create a keyword rule.** Use the real form. In the `options#calendar` snapshot, confirm the keyword-rule inputs are present, then set them and save through the UI (do not write `chrome.storage` directly). Re-run `drive state` and confirm the new rule appears in the response; re-open the workspace and confirm the rule row renders.
- **Proof.** The `--out` directory holds the workspace snapshot, the before/after `state.json` reads, and a screenshot showing the saved rule row. All artifacts record the `rules-keyword-create` entry point.

## Gotchas

- An exact rule with zero domains means "track this event but do not block" (`mode: unrestricted`) — an empty allowlist on a matched event is a feature, not a missing rule.
- A redundant exact rule (same domains as a keyword rule, no tag metadata) loses to the keyword source; the popup `Event rule: <name>` line tells you which source actually won.
- Confirm control labels in the snapshot before scripting clicks; the workspace renders different controls when disconnected versus connected.
