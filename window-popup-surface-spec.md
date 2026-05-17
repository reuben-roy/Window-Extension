# Window Popup and Docked Surface Spec

Status: Normative product spec

Last updated: 2026-04-22

## 1. Purpose

This document defines how the Window popup and docked side panel are supposed to work.

This is not an implementation snapshot. If the code and this document disagree, this document wins.

The goal is to make the popup, docked panel, and popup-to-workspace handoff stable enough that regressions are obvious and fixable.

## 2. Scope

This spec covers:

- The browser action popup
- The docked side panel version of the same surface
- Every visible button and interactive control in those surfaces
- The intended dimensions and layout rules
- How popup mode and docked mode switch
- What "Open Settings" is expected to hand off into
- The calendar workspace drag-and-drop contract, because the popup depends on it

This spec does not attempt to fully define every settings page detail outside the popup handoff, but it does define any workspace behavior that is required to preserve the popup product story.

## 3. Product Role

The popup is the fast command center for Window.

It exists to let the user do five things very quickly:

1. See what Window thinks is happening right now
2. Confirm whether blocking is active and what event is driving it
3. Finish or review focus tasks without opening the full workspace
4. Start a short intentional break
5. Capture or hand off work to the assistant without losing momentum

The popup is not supposed to be a full configuration screen.

Deep editing belongs in the full workspace.

The docked surface is the same product surface in a persistent browser-native form. It should feel like a pinned, always-available version of the popup, not like a separate app with different rules.

## 4. Core Principles

These rules are non-negotiable.

### 4.1 Never render as a broken shell

The popup must never open as:

- a narrow vertical strip
- a blank light-blue rectangle
- a widthless host waiting on React
- a surface that silently fails with no visible explanation

The popup host must reserve its shape before JavaScript boots.

If data is loading, show a real loading state.

If rendering fails, show a visible error card with readable copy.

### 4.2 Real data first

The popup should show current event, blocking state, tasks, points, and assistant status using real extension state.

It should not feel like decorative marketing art.

### 4.3 Low-copy, high-hierarchy

The popup should be lean.

The user has already said the UI becomes worse when too much explanatory copy is left in place.

That means:

- Section subtitles should be short
- Repeated explanatory sentences should be removed
- Tooltips can hold secondary explanation
- Cards must communicate by hierarchy, not by paragraphs

### 4.4 One-column first

The popup is a narrow utility surface.

Its primary layout is one column with stacked sections.

The docked surface should also be excellent in a narrow one-column layout. Any wider layout is a bonus, not a dependency.

### 4.5 No horizontal scroll

The popup and docked panel must never depend on horizontal scrolling.

Text can truncate. Lists can collapse. Content can scroll vertically inside the surface. Horizontal overflow is a failure.

### 4.6 Popup and docked are the same product surface

Popup mode and docked mode must expose the same mental model and the same core actions.

They may differ in:

- available vertical space
- how many recent items are shown before truncation
- whether an `Undock` button is present

They should not differ in product meaning.

## 5. Surface Model

### 5.1 Popup mode

Popup mode is the default browser action experience.

When the user clicks the extension action and persistent docking is off, Window opens as a floating action popup.

Popup mode is optimized for quick inspection and short actions.

### 5.2 Docked mode

Docked mode turns the same surface into a right-side panel that stays open next to the browser page.

When persistent docking is on:

- clicking the extension action should open the side panel
- future action clicks should continue opening the side panel
- the panel should stay available while the user browses

Docked mode is for users who want Window visible during work, not only when they deliberately open the popup.

### 5.3 Full workspace handoff

The popup is summary-plus-action.

The workspace is detail-plus-editing.

The most important popup handoff is `Open Settings`, which should open the full Calendar Workspace so the user can:

- inspect rules visually against real calendar events
- manage exact and keyword rules
- attach extended task sets to occurrences
- recover or reassign drag-and-drop behavior when needed

## 6. Canonical Dimensions

Browser extensions are desktop browser UI, so "all devices" here means desktop browser environments across different laptop and monitor sizes, DPI scales, and browser window sizes.

This is not a mobile surface.

### 6.1 Popup dimensions

Canonical popup dimensions:

- Width: `460px`
- Minimum height: `420px`
- Ideal working height: `560px` to `680px`
- Maximum visible popup height before internal scrolling: `760px`

Rules:

- The popup host should reserve the `460px` width before React renders
- The content area may scroll vertically
- The popup should never require horizontal scroll
- The popup must remain visually intact if the browser provides slightly less vertical space than ideal
- Loading and error states must use the same host size as the real popup

Fallback tolerance:

- If browser constraints force the surface below the ideal, the layout should still remain usable down to roughly `420px` effective width
- The intended host request remains `460px`

### 6.2 Docked panel dimensions

Docked mode is user-resizable, so the product should define a comfort range rather than one fixed width.

Canonical docked dimensions:

- Ideal width: `380px` to `420px`
- Acceptable working width: `360px` to `520px`
- Height: full browser viewport

Rules:

- The docked panel must be excellent at narrow widths
- The docked panel should keep the same one-column information architecture as the popup
- It should use the extra height to show more content, not to sprawl
- The header remains sticky
- The body scrolls vertically

### 6.3 Tap targets and control sizing

All interactive controls in popup and docked mode should honor these minimums:

- Minimum hit height: `40px`
- Small chip-style buttons may visually appear smaller, but their clickable area should still be comfortable
- Segmented controls should not compress labels to unreadable widths

## 7. Visual Direction

The intended look is:

- calm blue-first palette
- soft glass / layered panel surfaces
- strong hierarchy
- visible status chips
- rounded cards
- clean borders and shadows
- compact copy

The popup should look polished and purposeful, not plain and boxy.

It should borrow the strongest qualities of the promo concepts:

- fewer competing elements
- clearer hero state
- stronger sense of "this is what I should be doing right now"

It should not fake product capabilities or invent UI that does not exist.

## 8. Information Architecture

Section order is fixed:

1. Header
2. Focus
3. Analytics
4. Controls
5. Assistant

The header communicates the "right now" state.

The body communicates:

- what Window thinks is active
- what the user can do next
- where to go for deeper editing

## 9. Header Spec

### 9.1 Header layout

Header is sticky at the top of the surface.

Left side:

- Window badge
- blocking status badge
- current event title or fallback title
- one-line contextual caption

Right side:

- points / level bubble
- `Undock` button in docked mode only
- blocking toggle
- account avatar or signed-out account controls

### 9.2 Header content rules

Title:

- If a focus event is active, the header title should be the current event title
- If no focus event is active, the title falls back to `Window`

Caption:

- If an event is active, caption shows event time range and current blocking state
- If no event is active but another event is upcoming, caption shows the next focus block
- If calendar is connected but no current or next focus block exists, caption says so
- If calendar is not connected, caption instructs the user to connect it

### 9.3 Header buttons and controls

| Control | Placement | Visible when | What it should do |
| --- | --- | --- | --- |
| `Blocking on` / `Blocking off` | Header right cluster | Always | Toggle master focus blocking on or off. This is the user's top-level control for whether Window actively restricts browsing. |
| `Undock` | Header right cluster, between points bubble and blocking toggle | Docked mode only | Switch persistent surface mode back to popup mode. Future action clicks should open the popup again. The current docked panel should close immediately if possible, or at minimum stop behaving as the primary surface. |
| Account avatar button | Far right header cluster | Signed-in state | Open the account menu. |
| `Sign in with Google` | Replaces avatar/menu area in signed-out state | Signed-out state | Start Google account sign-in. |
| Compact calendar `Connect` / `Reconnect` / `Disconnect` | Signed-out account area | Signed-out state or no account menu available | Show calendar connection status and let the user connect or disconnect calendar access without opening deeper settings. |

### 9.4 Account avatar menu

The account menu opens from the avatar button and closes on:

- outside click
- `Escape`
- sign-out

The menu must show:

- avatar
- display name
- secondary email if relevant
- sync status
- calendar connection card
- conflict resolution state if needed
- `Refresh`
- `Sign out`

Buttons inside the account menu:

| Control | Placement | Visible when | What it should do |
| --- | --- | --- | --- |
| `Refresh` | Menu footer, left | Signed-in | Refresh account state and latest sync status. |
| `Sign out` | Menu footer, right | Signed-in | Disconnect backend account session from this browser and close the menu. |
| `Connect` | Calendar status row | Calendar disconnected | Request calendar access. |
| `Reconnect` | Calendar status row | Calendar auth error or expired access | Re-run calendar connection flow. |
| `Disconnect` | Calendar status row | Calendar connected | Remove calendar access while keeping account sync separate. |
| `Use This Browser` | Conflict resolution panel | Sync conflict present | Resolve conflict by keeping local browser data as the source of truth. |
| `Use Account Data` | Conflict resolution panel | Sync conflict present | Resolve conflict by replacing local browser data with remote account data. |

## 10. Focus Section Spec

The Focus section is the most important content block in the popup.

It answers:

- What am I supposed to be doing?
- Is Window currently restricting me?
- What domains are allowed right now?
- Do I have tasks to finish?

### 10.1 Focus section composition

The section contains:

- a hero-style Focus Snapshot card
- level / points progress
- optional active break countdown
- task queue or empty task state

### 10.2 Focus Snapshot card

The Focus Snapshot card is not decorative. It is the summary card for the current focus context.

It should show:

- `Focus Snapshot` badge
- blocking status badge
- current event title or `Window`
- short caption
- current score
- level
- pills for `Tasks ready`, `Allowed now`, optional streak, and optional next event
- allowed-domain chips when domains are present

It is intentionally the most visually prominent card in the popup.

### 10.3 Focus buttons and controls

| Control | Placement | Visible when | What it should do |
| --- | --- | --- | --- |
| `Mark Task Done` | Top-right of the task area inside Focus | At least one active or carryover task exists | Open the completion modal so the user can mark one task finished with a required note. |
| Task queue expand / collapse button (`show` / `hide`) | Task queue header row | At least one active or carryover task exists | Expand or collapse the task list. |

### 10.4 Focus task queue behavior

The task queue should:

- default to collapsed
- summarize carryover and active counts in the header
- prioritize carryover tasks first, then active tasks
- show event title, task profile, scheduled date, and urgency
- visually mark carryover items

If there are no actionable tasks, the section should show a compact empty state, not a large empty card.

### 10.5 Active break state

If the user is currently on a timed break, the Focus section should show a visible countdown card.

Rules:

- the card is only shown while a break is active
- it must show remaining time
- it must make clear that blocking resumes automatically

## 11. Analytics Section Spec

The Analytics section is intentionally compact.

It is not supposed to compete with the full analytics workspace.

It should tell the user:

- current activity classification
- primary resolved task tag
- a simple session or seven-day summary
- a quick segment breakdown

### 11.1 Analytics controls

This section is mostly informational.

It does not require primary action buttons in the popup itself.

If deeper editing or override is needed, that belongs in the full workspace.

### 11.2 Analytics display rules

The section should show:

- current status, or `Idle`
- primary tag, or `None`
- current session summary if a session is live
- otherwise a seven-day summary
- a visual distribution bar
- small metric chips for productive, supportive, distracted, and away minutes

## 12. Controls Section Spec

The Controls section contains fast, non-destructive adjustments.

It should feel operational, not configuration-heavy.

### 12.1 Controls inventory

| Control | Placement | What it should do |
| --- | --- | --- |
| Break length selector | First row, right side of `Break length` row | Set the default duration used by manual breaks and blocked-page quick breaks. |
| Surface mode segmented control (`Popup` / `Docked`) | Second row, right side of `Surface mode` row | Switch between popup and persistent docked side panel behavior. |
| `Open Settings` | Quick Actions footer, left | Open the full Window workspace. |
| `Start Break` | Quick Actions footer, right | Start a timed focus break immediately using the currently selected break length. |

### 12.2 Break length behavior

Rules:

- Valid choices are `5 min`, `10 min`, and `15 min`
- Changing the selector updates the default for future breaks
- Changing the selector does not mutate an already-active break

### 12.3 Surface mode behavior

`Popup` means:

- browser action click opens the popup
- no persistent side panel is forced open

`Docked` means:

- browser action click opens the side panel
- the panel becomes the persistent primary surface
- switching into docked mode from the popup should open the docked panel immediately in the current tab

### 12.4 Quick actions behavior

`Open Settings` should:

- open the extension options/workspace page
- land on the Workspace surface, not an arbitrary settings subsection
- preserve the user mental model that the popup is a summary surface and the workspace is the editing surface

`Start Break` should:

- trigger the same break system used by blocked-page quick breaks
- temporarily lift blocking for the configured duration
- show the break countdown back in the popup or docked surface

## 13. Assistant Section Spec

The Assistant section exists to let the user keep moving without leaving the browser.

It contains:

- connector routing
- async handoff state
- idea capture
- reusable sessions
- recent handoffs

### 13.1 Assistant toolbar buttons

| Control | Placement | Visible when | What it should do |
| --- | --- | --- | --- |
| `Refresh` | Top of Assistant section | Always | Refresh assistant state from the backend layer. |
| `New Session` | Top of Assistant section | Always | Create a new OpenClaw session. |
| `Reuse Session` | Top of Assistant section | Only when a reusable non-closed session exists | Reattach the assistant flow to the most recent reusable session. |
| `Cancel Job` | Top of Assistant section | Only when an idea job is currently running | Cancel the current idea-processing job. |

### 13.2 Assistant settings rows

| Control | Placement | What it should do |
| --- | --- | --- |
| Connector select | `Connector` row | Choose which configured backend connector receives assistant requests. |
| Model selector | `Model selector` row | Choose preferred model label for routing. This may be placeholder-only now, but the UI should still behave like a real preference control. |
| Notification timing select | `Notification timing` row | Decide when completed assistant tasks notify the user. |
| `Fresh thread` / `Reuse current` segmented control | `Session behavior` row | Control whether assistant capture continues an existing session or always starts a fresh one. |
| `Manual` / `Auto-create` segmented control | `New session fallback` row | Decide whether Window automatically creates a new session when no reusable one exists. |
| `Off` / `On` segmented control | `Break telemetry` row | Enable or disable domain-only break telemetry. |

### 13.3 Handoff task composer

The handoff composer should include:

- title area naming the selected connector
- `Send Task` button on the right
- textarea for a longer-running task prompt
- inline error copy if submission fails

Rules:

- `Send Task` is disabled when no connector is available
- on success, the input clears
- background task state should appear in `Recent handoffs`

### 13.4 Recent handoffs

Each handoff card should show:

- task title
- status badge
- `New` badge if unread
- last updated time
- notification mode
- prompt excerpt
- result summary or error
- optional expandable output preview

Buttons inside recent handoffs:

| Control | Placement | Visible when | What it should do |
| --- | --- | --- | --- |
| `Cancel` | Top-right of a handoff card | Task is queued or running | Cancel the assistant task. |
| `Review output` disclosure | Inside a completed handoff card | Result output exists | Expand and reveal a readable output preview. |

### 13.5 Idea capture composer

The idea capture composer should include:

- status line showing whether sync is connected or queued locally
- `Capture` button
- short multiline textarea
- inline error copy if submission fails

Rules:

- the user should be able to submit a quick idea with minimal friction
- if backend sync is unavailable, the product should queue locally rather than block the capture flow outright

### 13.6 Recent sessions

Recent sessions are a lightweight reuse rail.

Each session card should show:

- session title
- session status
- model label if present
- `Active` badge when it matches the current active session
- `Use` button

| Control | Placement | What it should do |
| --- | --- | --- |
| `Use` | Right side of a session row | Reuse that specific session. |

### 13.7 Idea inbox

The idea inbox should only show a few recent unarchived items and remain compact by default.

Each item may show:

- prompt
- status
- `New` badge
- report summary and scored dimensions if the report is ready
- error state if the job failed

Buttons inside the idea inbox:

| Control | Placement | Visible when | What it should do |
| --- | --- | --- | --- |
| `Keep` | Inside a completed unsaved idea card | Idea has a report and has not been saved or archived | Keep the idea. |
| `Discard` | Inside a completed unsaved idea card | Idea has a report and has not been saved or archived | Archive or reject the idea. |
| `Retry` | Inside an errored idea card | Idea failed or has an error | Re-run the idea evaluation flow. |

## 14. Completion Modal Spec

The completion modal is the popup's focused task-completion flow.

It should feel fast, lightweight, and safe against accidental gaming.

### 14.1 Modal contents

The modal includes:

- title
- close button
- optional task selector when multiple tasks are available
- anti-gaming notice when the user is too early
- required note textarea
- keyboard hints
- `Cancel`
- `Done`

### 14.2 Completion modal buttons

| Control | Placement | What it should do |
| --- | --- | --- |
| `Close` (`x`) | Top-right of modal header | Dismiss the modal without saving. |
| Task selector | Top of modal body when multiple tasks exist | Let the user choose which task to mark done. |
| `Cancel` | Bottom-left action | Close the modal without saving. |
| `Done` | Bottom-right action | Submit task completion with the required note. |

### 14.3 Completion rules

Rules:

- a note is required
- if multiple tasks exist, the user can choose one
- task completion may be blocked until a meaningful portion of the scheduled block has elapsed
- when blocked, the reason must be explicit
- `Cmd+Enter` or `Ctrl+Enter` submits
- `Escape` cancels

## 15. Docked Mode Spec

### 15.1 How the product enters docked mode

Docked mode is entered by selecting `Docked` in the `Surface mode` segmented control.

Expected behavior:

1. Persist the user's surface preference
2. Reconfigure the browser action so future clicks open the side panel
3. Open the side panel immediately in the current tab
4. Preserve current Window state so the user does not feel like they opened a different product

### 15.2 How the product leaves docked mode

Docked mode is exited by:

- selecting `Popup` in the `Surface mode` control, or
- clicking `Undock` in the docked header

Expected behavior:

1. Persist popup mode as the preferred surface
2. Reconfigure the browser action so future clicks open the popup
3. Close the existing docked panel immediately if browser APIs allow
4. If immediate close is not technically possible, the panel should clearly reflect that it is no longer the primary surface and should not reopen automatically

### 15.3 How the docked surface should look

The docked panel should look like a persistent, browser-native version of the popup.

It should:

- use the same header language
- use the same section order
- keep the same blue-first visual system
- feel slightly roomier vertically
- show a few more recent items because height is available
- include an `Undock` button in the header

It should not:

- become a completely different layout language
- hide major popup functionality
- introduce horizontal scrolling
- feel like a thin stretched column with giant empty gaps

### 15.4 Docked content differences

Allowed differences in docked mode:

- show more recent handoffs before truncation
- show more recent sessions before truncation
- use more textarea rows
- preserve scroll more naturally because the panel stays open

Disallowed differences:

- changing the meaning of controls
- moving critical buttons to unrelated places
- removing core popup actions

## 16. Full Workspace Handoff Spec

The popup is not where event editing and drag-and-drop live.

That belongs in the full workspace opened by `Open Settings`.

### 16.1 Open Settings destination

`Open Settings` should open the user into the Workspace surface of the options page.

The user should land in the Calendar Workspace, not in a generic low-context settings form.

### 16.2 Calendar Workspace requirements

The workspace must support:

- `Today`, `Prev`, and `Next`
- `Month`, `Week`, and `Day` view switching
- a focused time range for week/day views that trims dead overnight hours and centers actual events
- event click to inspect or edit exact rules
- current or selected occurrence rail
- extended task library
- drag-and-drop or explicit apply actions for binding extended task sets to occurrences

## 17. Drag-and-Drop Contract

This section is included because drag-and-drop is a critical part of the popup-to-workspace handoff.

If drag-and-drop breaks, the popup story is incomplete.

### 17.1 Source items

Draggable source items include:

- built-in roadmap cards
- built-in subgroup cards
- user-created task set cards

Each draggable source must visibly expose a drag affordance.

`Apply` must always exist as a keyboard-safe fallback when a relevant occurrence is selected.

### 17.2 Drop targets

Valid drop targets are calendar occurrences in the workspace calendar.

The event chip and its containing event surface should both behave as the same drop target.

### 17.3 Drag-and-drop behavior

When a valid drag enters an event:

- the event should visually highlight
- the highlight should remain stable while moving between nested elements inside the same occurrence
- the highlight should clear on leave

When a drop succeeds:

- the dragged task set is assigned to that occurrence
- the current/selected occurrence rail updates immediately
- the task set source remains intact
- the UI should not require a full reload to show the new assignment

### 17.4 Apply button fallback

Every task set that can be dragged onto an occurrence should also be applicable through a normal button click when an occurrence is selected.

This is required for:

- keyboard accessibility
- trackpad awkwardness
- regression recovery when drag events are flaky

### 17.5 Remove assignment behavior

Removing an assignment from an occurrence should:

- remove only the occurrence binding
- not delete the underlying library task set
- update the occurrence rail immediately

## 18. Copy Rules

The user has already signaled that the UI gets worse when explanatory text piles up.

The popup should follow these copy rules:

- one section title
- one short subtitle if needed
- one tooltip for secondary explanation
- avoid repeated helper paragraphs
- avoid filler labels
- avoid lines that merely restate the obvious

In practical terms, the popup should prefer:

- chips
- strong values
- concise labels
- meaningful empty states

over long instructional text.

## 19. Empty, Loading, and Error States

### 19.1 Loading

Before the app state is ready, the surface should show a real loading shell inside the correct popup dimensions.

### 19.2 Empty states

Expected compact empty states:

- no current task
- no queued ideas
- no recent handoffs
- no current focus block
- no calendar connection

Empty states should explain what is missing and what the next meaningful action is.

They should not leave large dead blank areas with no explanation.

### 19.3 Error states

The popup must show readable error surfaces for:

- state load failure
- runtime render failure
- assistant submission failure
- idea capture failure
- account or calendar connection failure

Error states should be visible, concise, and actionable.

## 20. Accessibility and Input Rules

The popup and docked panel should support:

- keyboard navigation
- `Escape` to close menus and modals
- visible focus states
- readable labels for icon-only controls
- no drag-only critical flow without a click alternative

Important keyboard expectations:

- account menu closes on `Escape`
- completion modal supports `Escape`
- completion modal supports `Cmd+Enter` / `Ctrl+Enter`
- calendar events in the workspace should be keyboard focusable and activatable

## 21. Data Robustness Rules

The popup must remain renderable even if stored state is stale, partial, or from an older schema version.

That means:

- missing arrays must degrade to empty arrays
- missing nested state must degrade to defaults
- the popup should not assume shape-perfect local storage
- runtime data mismatches should never collapse the entire surface

This is a product requirement, not just a code hygiene note.

## 22. Regression Checklist

Any popup or docked-mode change should be considered incomplete unless all of the following remain true:

- The browser action opens a full rectangular popup in popup mode
- The popup is never a vertical strip
- The popup is never a blank shell
- The header always shows a real title, status, and account/control cluster
- `Blocking on/off` still works
- `Start Break` still triggers a real break
- `Open Settings` still reaches the workspace
- `Surface mode` still switches between popup and docked correctly
- Docked mode still exposes `Undock`
- The account menu still works for sign-in, sign-out, refresh, and calendar connect/disconnect
- `Mark Task Done` still opens the modal and saves correctly
- Assistant task submission still works
- Idea capture still works and can queue locally when needed
- Recent sessions still allow reuse
- Recent handoffs still allow cancel and result review
- Idea inbox still supports `Keep`, `Discard`, and `Retry`
- Opening the workspace still preserves drag-and-drop and apply behavior for extended task sets
- Calendar occurrences still highlight as drop targets during drag
- Dropping a task set onto an occurrence still assigns it immediately
- Removing an occurrence assignment still removes only the occurrence binding
- Week/day calendar views still focus on the hours where events exist
- No horizontal scrolling appears in popup or docked mode

## 23. One-Sentence Summary

Window's popup should be a stable, polished, real-data control surface that tells the user what they should be doing right now, lets them act on it quickly, and hands them off cleanly into a docked panel or full calendar workspace when they need more room or deeper control.
