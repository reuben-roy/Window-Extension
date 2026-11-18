# Learning review

Learning review turns picked study topics into spaced-repetition quizzes. A user selects topics (or adds a custom one) in the options study view, saves them, and works the review queue; the popup shows a review hero (`due` count, topics, streak) that starts the next question. Quiz content can also surface in-page while the learning feature flag is on.

## Sub-features

- `learning-topics` picks catalog subjects or a custom topic and saves the selection (`Save topics`).
- `learning-queue` shows due review cards and the pack status (`Review queue`, `No review items due yet` when empty).
- `learning-hero` shows the popup review hero (due count, topics, week streak) and starts a review.
- `learning-answer` submits an answer and advances the queue (needs a ready quiz pack).

## How to get to it (user POV)

- In the options page, use the study view (`Learn` tab): `SEARCH SUBJECTS OR TOPICS`, `CUSTOM TOPIC` / `Add`, `Save topics`.
- In the popup, use the `REVIEW` hero: `Choose topics` (opens the study view) or start the due review.
- Full question answering additionally needs generated quiz packs (backend import or regeneration job).

## Driving it with control-window

Preconditions:

- `control-window doctor` passes and the run launched via `control-window launch`.
- `learning-topics` and `learning-queue` (empty state) need no backend; `learning-answer` needs quiz packs plus the backend (`control-window doctor --backend` passing) — report it as skipped otherwise.

- **Study view.** Open the learning tab. Run `control-window drive snapshot "options#learning" --out "$VERIFY_OUT/learning"`. The snapshot contains `STUDY TOPICS`, `SEARCH SUBJECTS OR TOPICS`, `CUSTOM TOPIC`, `SELECTED TOPICS`, `Save topics`, and `Review queue` (`innerText` reflects the rendered all-caps styling; match this exact casing).
- **Popup hero.** Open the popup. Run `control-window drive snapshot popup --out "$VERIFY_OUT/learning-hero"`. The snapshot contains the `REVIEW` hero with the streak line and the `Choose topics` / `Study view` actions.
- **Save a topic.** Use the real form. In the study view, add a custom topic (a `verify-<RUN_ID>`-suffixed name so reruns never collide), choose `Save topics`, re-snapshot, and confirm the `SELECTED TOPICS` count increased; then remove it again so the next run starts clean.
- **Proof.** The `--out` directory holds both snapshots, the before/after screenshots, and `state.json` (`learningState.userTopics` / `reviewQueue`) confirming the stored selection. All artifacts record the entry point used.

## Gotchas

- `No review items due yet` with `0 cards` is the correct empty state, not a missing backend — packs only exist after import or a worker regeneration job.
- Suggestions (`Suggested from activity`) never auto-enroll; only `Save topics` changes the stored set.
- Topic names are matched by key; always use a run-suffixed custom topic and delete it during the run so parallel or repeated runs do not interfere.
