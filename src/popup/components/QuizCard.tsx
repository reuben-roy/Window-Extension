import React from 'react';
import type { QuizAnswerResult, QuizDifficultySelfRating, QuizPrompt } from '../../shared/types';

/**
 * The single quiz-answering experience. Rendered by the toolbar popup, the
 * Chrome side panel, and the in-page quiz panel iframe — keep it the only
 * place answer flow, hints, difficulty rating, and auto-advance live.
 */
export function QuizCard({
  mode,
  prompt,
  result,
  errorMessage,
  selectedChoiceId,
  hintVisible,
  submitting,
  difficultyRating,
  autoAdvanceSecsLeft,
  onSelectChoice,
  onToggleHint,
  onSubmit,
  onGiveUp,
  onMoreQuestions,
  onOpenLearningWorkspace,
  onRateDifficulty,
  onClose,
}: {
  mode: 'popup' | 'panel';
  prompt: QuizPrompt;
  result: QuizAnswerResult | null;
  errorMessage: string | null;
  selectedChoiceId: string | null;
  hintVisible: boolean;
  submitting: boolean;
  difficultyRating: QuizDifficultySelfRating | null;
  autoAdvanceSecsLeft: number | null;
  onSelectChoice: (choiceId: string) => void;
  onToggleHint: () => void;
  onSubmit: () => void;
  onGiveUp: () => void;
  onMoreQuestions: () => void;
  onOpenLearningWorkspace: () => void;
  onRateDifficulty: (rating: QuizDifficultySelfRating) => void;
  onClose: () => void;
}): React.JSX.Element {
  const resolvedCorrectChoiceId = result?.correctChoiceId ?? prompt.correctChoiceId;
  const selectedWrongExplanation =
    result?.wrongAnswerExplanation ??
    (selectedChoiceId ? prompt.wrongAnswerExplanations[selectedChoiceId] ?? null : null);
  const canSubmit = !submitting && selectedChoiceId !== null && result === null;

  return (
    <section className={`fg-card overflow-hidden ${mode === 'panel' ? 'min-h-[56vh]' : 'min-h-[360px]'}`}>
      <div className="border-b border-[var(--fg-border)] bg-gradient-to-r from-sky-50 via-white to-white px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[var(--fg-accent-soft)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-accent)]">
                Review
              </span>
              <span className="rounded-full border border-[var(--fg-border)] bg-white px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-[var(--fg-muted)]">
                {prompt.difficulty}
              </span>
            </div>
            <h2 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-[var(--fg-text)]">
              {prompt.topicLabel}
            </h2>
            <p className="mt-1 text-sm text-[var(--fg-muted)]">
              Ch {prompt.chapterOrdinal}/{prompt.totalChapters} · {prompt.chapterTitle} · {prompt.pointsReward} pts · streak {result?.updatedStreak ?? prompt.streak}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="fg-button-ghost shrink-0 px-2 py-1 text-[11px]"
          >
            Dismiss
          </button>
        </div>
      </div>

      <div className="flex h-full flex-col justify-between px-4 py-4">
        <div className="space-y-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--fg-muted)]">
              Prompt
            </p>
            <p className="mt-2 text-base leading-7 text-[var(--fg-text)]">{prompt.prompt}</p>
          </div>

          {prompt.artifact ? <QuizArtifactFigure artifact={prompt.artifact} /> : null}

          <div className="space-y-2">
            {prompt.choices.map((choice) => {
              const isSelected = selectedChoiceId === choice.id;
              const isCorrect = resolvedCorrectChoiceId === choice.id;
              const isIncorrectSelection =
                result !== null && selectedChoiceId === choice.id && resolvedCorrectChoiceId !== choice.id;

              return (
                <button
                  key={choice.id}
                  type="button"
                  onClick={() => {
                    if (result === null) {
                      onSelectChoice(choice.id);
                    }
                  }}
                  disabled={result !== null}
                  className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                    result !== null
                      ? isCorrect
                        ? 'border-emerald-300 bg-emerald-50'
                        : isIncorrectSelection
                          ? 'border-rose-300 bg-rose-50'
                          : 'border-[var(--fg-border)] bg-white opacity-70'
                      : isSelected
                        ? 'border-[var(--fg-accent)] bg-[var(--fg-accent-soft)]'
                        : 'border-[var(--fg-border)] bg-white hover:border-[var(--fg-accent)]/40'
                  } ${result !== null ? 'cursor-default' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--fg-border)] bg-white text-[11px] font-semibold text-[var(--fg-muted)]">
                      {choice.label}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm leading-6 text-[var(--fg-text)]">{choice.body}</p>
                      {result !== null && isCorrect ? (
                        <p className="mt-1 text-[11px] font-medium text-emerald-700">Correct answer</p>
                      ) : null}
                      {result !== null && isIncorrectSelection && selectedWrongExplanation ? (
                        <p className="mt-1 text-[11px] leading-5 text-rose-700">{selectedWrongExplanation}</p>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {hintVisible && prompt.hint ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
              <span className="font-medium">Hint:</span> {prompt.hint}
            </div>
          ) : null}

          {result ? (
            <div className="space-y-2 rounded-xl border border-[var(--fg-border)] bg-[var(--fg-panel-soft)]/75 px-3 py-3">
              <p className={`text-sm font-semibold ${result.correct ? 'text-emerald-700' : 'text-rose-700'}`}>
                {result.correct ? `Correct. +${result.pointsAwarded} pts` : 'Review this before moving on'}
              </p>
              <p className="text-sm leading-6 text-[var(--fg-text)]">
                {result.explanation ?? prompt.explanation ?? 'Window will attach a short explainer here as packs mature.'}
              </p>
              {result.nextDueAt ? (
                <p className="text-[11px] text-[var(--fg-muted)]">
                  Next review {formatRelativeDueTime(result.nextDueAt)}.
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--fg-border)] pt-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--fg-muted)]">
                  How was this?
                </p>
                {(
                  [
                    { id: 'too_easy', label: 'Too easy' },
                    { id: 'just_right', label: 'Just right' },
                    { id: 'too_hard', label: 'Too hard' },
                  ] as const
                ).map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onRateDifficulty(id)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      difficultyRating === id
                        ? 'border-[var(--fg-accent)] bg-[var(--fg-accent-soft)] text-[var(--fg-accent)]'
                        : 'border-[var(--fg-border)] bg-white text-[var(--fg-muted)] hover:border-[var(--fg-accent)]/40'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {errorMessage ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-900">
              {errorMessage}
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--fg-border)] pt-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onToggleHint}
              className="fg-button-secondary px-3 py-2 text-[11px]"
            >
              {hintVisible ? 'Hide hint' : 'Hint'}
            </button>
            {result === null ? (
              <button
                type="button"
                onClick={onGiveUp}
                disabled={submitting}
                className="fg-button-secondary px-3 py-2 text-[11px] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Give up
              </button>
            ) : null}
            <button
              type="button"
              onClick={onOpenLearningWorkspace}
              className="fg-button-ghost px-3 py-2 text-[11px]"
            >
              Open full study view
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onMoreQuestions}
              className="fg-button-primary px-3 py-2 text-[11px]"
            >
              {autoAdvanceSecsLeft !== null
                ? `Next in ${autoAdvanceSecsLeft}s`
                : 'More questions'}
            </button>
            {result === null ? (
              <button
                type="button"
                onClick={onSubmit}
                disabled={!canSubmit}
                className="fg-button-primary px-3 py-2 text-[11px] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Checking…' : 'Submit'}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function QuizArtifactFigure({
  artifact,
}: {
  artifact: NonNullable<QuizPrompt['artifact']>;
}): React.JSX.Element {
  if (artifact.type === 'image' && artifact.imageUrl) {
    return (
      <figure className="overflow-hidden rounded-xl border border-[var(--fg-border)] bg-white">
        <img src={artifact.imageUrl} alt={artifact.alt} className="h-auto w-full object-cover" />
        <figcaption className="border-t border-[var(--fg-border)] px-3 py-2 text-[11px] leading-5 text-[var(--fg-muted)]">
          {artifact.alt}
        </figcaption>
      </figure>
    );
  }

  if (artifact.type === 'graph' && artifact.graphSpec) {
    return (
      <figure className="rounded-xl border border-[var(--fg-border)] bg-white p-3">
        <SimpleGraphArtifact graphSpec={artifact.graphSpec} />
        <figcaption className="mt-2 text-[11px] leading-5 text-[var(--fg-muted)]">{artifact.alt}</figcaption>
      </figure>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--fg-border)] bg-[var(--fg-panel-soft)]/75 px-3 py-3 text-sm text-[var(--fg-muted)]">
      {artifact.alt}
    </div>
  );
}

function SimpleGraphArtifact({
  graphSpec,
}: {
  graphSpec: Record<string, unknown>;
}): React.JSX.Element {
  const points = extractGraphPoints(graphSpec);

  if (points.length < 2) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-4 text-center text-[11px] text-[var(--fg-muted)]">
        Graph data is stored structurally and will render here when the pack includes numeric points.
      </div>
    );
  }

  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const xSpan = maxX - minX || 1;
  const ySpan = maxY - minY || 1;
  const plotPoints = points
    .map((point) => {
      const x = 18 + ((point.x - minX) / xSpan) * 284;
      const y = 170 - ((point.y - minY) / ySpan) * 144;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg viewBox="0 0 320 190" className="h-[180px] w-full" role="img" aria-label="Quiz graph artifact">
      <rect x="0" y="0" width="320" height="190" rx="14" fill="#F8FBFF" />
      <line x1="18" y1="170" x2="302" y2="170" stroke="#B7C6D9" strokeWidth="1.5" />
      <line x1="18" y1="24" x2="18" y2="170" stroke="#B7C6D9" strokeWidth="1.5" />
      <polyline
        fill="none"
        stroke="#2F6DF6"
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={plotPoints}
      />
      {points.map((point, index) => {
        const x = 18 + ((point.x - minX) / xSpan) * 284;
        const y = 170 - ((point.y - minY) / ySpan) * 144;
        return <circle key={`${point.x}-${point.y}-${index}`} cx={x} cy={y} r="4" fill="#2F6DF6" />;
      })}
    </svg>
  );
}

function formatRelativeDueTime(value: string): string {
  const delta = new Date(value).getTime() - Date.now();
  const minutes = Math.round(delta / 60_000);

  if (minutes <= 0) {
    const overdueMinutes = Math.abs(minutes);
    if (overdueMinutes < 60) return overdueMinutes === 0 ? 'is due now' : `was due ${overdueMinutes} min ago`;
    const overdueHours = Math.round(overdueMinutes / 60);
    return `was due ${overdueHours} hour${overdueHours === 1 ? '' : 's'} ago`;
  }

  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

function extractGraphPoints(graphSpec: Record<string, unknown>): Array<{ x: number; y: number }> {
  const rawPoints = graphSpec.points;
  if (!Array.isArray(rawPoints)) {
    return [];
  }

  return rawPoints
    .map((point) => {
      if (Array.isArray(point) && point.length >= 2) {
        const [x, y] = point;
        return typeof x === 'number' && typeof y === 'number' ? { x, y } : null;
      }

      if (!point || typeof point !== 'object') {
        return null;
      }

      const candidate = point as { x?: unknown; y?: unknown };
      return typeof candidate.x === 'number' && typeof candidate.y === 'number'
        ? { x: candidate.x, y: candidate.y }
        : null;
    })
    .filter((point): point is { x: number; y: number } => point !== null);
}
