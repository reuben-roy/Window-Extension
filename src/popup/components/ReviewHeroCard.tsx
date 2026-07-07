import React from 'react';

/** Popup / panel hero: review status and the entry point into the quiz flow. */
export function ReviewHeroCard({
  dueReviewCount,
  topics,
  readyPackCount,
  weekStreak,
  errorMessage,
  busy,
  onStartReview,
  onOpenLearningWorkspace,
}: {
  dueReviewCount: number;
  topics: string[];
  readyPackCount: number;
  weekStreak: number;
  errorMessage: string | null;
  busy: boolean;
  onStartReview: () => void;
  onOpenLearningWorkspace: () => void;
}): React.JSX.Element {
  const hasTopics = topics.length > 0;
  const headline = !hasTopics
    ? 'Pick your study topics'
    : dueReviewCount > 0
      ? `${dueReviewCount} card${dueReviewCount === 1 ? '' : 's'} due for review`
      : 'All caught up';
  const supporting = !hasTopics
    ? 'Choose subjects in the study view and Window will build spaced-repetition quizzes for them.'
    : readyPackCount === 0
      ? `${topics.slice(0, 3).join(', ')} · quiz packs are still being prepared.`
      : `${topics.slice(0, 3).join(', ')}${topics.length > 3 ? ` +${topics.length - 3}` : ''}`;

  return (
    <section className="fg-card overflow-hidden">
      <div className="bg-gradient-to-r from-sky-50 via-white to-white px-3.5 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--fg-accent)]">
              Review
            </p>
            <h2 className="mt-1 text-lg font-semibold leading-snug tracking-[-0.03em] text-[var(--fg-text)]">
              {headline}
            </h2>
            <p className="mt-0.5 text-[11px] leading-snug text-[var(--fg-muted)]">{supporting}</p>
          </div>
          {weekStreak > 0 ? (
            <span className="shrink-0 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
              {weekStreak}w streak
            </span>
          ) : null}
        </div>

        {errorMessage ? (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-snug text-amber-900">
            {errorMessage}
          </p>
        ) : null}

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {hasTopics ? (
            <button
              type="button"
              onClick={onStartReview}
              disabled={busy || readyPackCount === 0}
              className="fg-button-primary px-3 py-1.5 text-[11px] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {dueReviewCount > 0 ? 'Start review' : 'Practice a question'}
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenLearningWorkspace}
              className="fg-button-primary px-3 py-1.5 text-[11px]"
            >
              Choose topics
            </button>
          )}
          <button
            type="button"
            onClick={onOpenLearningWorkspace}
            className="fg-button-ghost px-2.5 py-1.5 text-[11px]"
          >
            Study view
          </button>
        </div>
      </div>
    </section>
  );
}
