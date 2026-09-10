import React, { useCallback, useEffect, useState } from 'react';
import { findExtendedTaskAssignment } from '../shared/extendedTasks';
import { isBlockingFeatureEnabled, isLearningFeatureEnabled } from '../shared/learning';
import type {
  CalendarEvent,
  QuizAnswerResult,
  QuizDifficultySelfRating,
  QuizPrompt,
  StateResponse,
} from '../shared/types';
import { formatBlockingPauseTimeLabel, isDailyBlockingPauseActive } from '../shared/blockingSchedule';
import AccountStatusControl from '../shared/components/AccountStatusControl';
import CompactSettingRow from '../shared/components/CompactSettingRow';
import Toggle from '../shared/components/Toggle';
import PointsBubble from '../shared/components/PointsBubble';
import CompletionModal from './components/CompletionModal';
import { QuizCard } from './components/QuizCard';
import { ReviewHeroCard } from './components/ReviewHeroCard';
import TaskDetailModal from './components/TaskDetailModal';
import type { TaskDetailSelection } from './components/TaskDetailModal';
import TaskQueue from './components/TaskQueue';

const POPUP_WIDTH_PX = 460;
/** Wider while block detail modal is open (two-column layout). */
const POPUP_WIDTH_DETAIL_PX = 620;
const POPUP_MIN_HEIGHT_PX = 420;

export function getPersistentPanelControl(
  _mode: 'popup' | 'panel',
  persistentPanelEnabled: boolean,
  isEmbedded: boolean,
): 'dock' | 'undock' | null {
  if (isEmbedded) return null;
  return persistentPanelEnabled ? 'undock' : 'dock';
}

export default function Popup({
  mode = 'popup',
  isEmbedded = false,
}: {
  mode?: 'popup' | 'panel';
  isEmbedded?: boolean;
} = {}): React.JSX.Element {
  const [state, setState] = useState<StateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [completionModalOpen, setCompletionModalOpen] = useState(false);
  const [taskDetailSelection, setTaskDetailSelection] = useState<TaskDetailSelection | null>(null);
  const [breakStarting, setBreakStarting] = useState(false);
  const [endBreakBusy, setEndBreakBusy] = useState(false);
  const [breakActionError, setBreakActionError] = useState<string | null>(null);
  const [quizSelectedChoiceId, setQuizSelectedChoiceId] = useState<string | null>(null);
  const [quizSubmitting, setQuizSubmitting] = useState(false);
  const [quizHintVisible, setQuizHintVisible] = useState(false);
  const [quizAutoAdvanceSecsLeft, setQuizAutoAdvanceSecsLeft] = useState<number | null>(null);
  const [quizAutoAdvanceStartedAt, setQuizAutoAdvanceStartedAt] = useState<number | null>(null);
  const [quizActionError, setQuizActionError] = useState<string | null>(null);
  const [quizDifficultySelfRating, setQuizDifficultySelfRating] = useState<QuizDifficultySelfRating | null>(null);
  const [, setBreakCountdownTick] = useState(0);

  const loadState = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response: unknown) => {
      if (chrome.runtime.lastError) {
        setState(null);
        setLoadError(chrome.runtime.lastError.message ?? 'Window could not load the latest extension state.');
        setLoading(false);
        return;
      }

      if (!isStateResponse(response)) {
        setState(null);
        setLoadError('Window could not load the latest extension state.');
        setLoading(false);
        return;
      }

      setState(response);
      setLoadError(null);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    loadState();
    chrome.runtime.sendMessage({ type: 'REFRESH_ACCOUNT_STATE' });
    chrome.runtime.sendMessage({ type: 'REFRESH_LEARNING_STATE' });
    const listener = () => loadState();
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [loadState]);

  useEffect(() => {
    const snooze = state?.snoozeState;
    if (!snooze?.active || !snooze.expiresAt) return;
    const id = window.setInterval(() => setBreakCountdownTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [state?.snoozeState?.active, state?.snoozeState?.expiresAt]);

  const learningState = state?.learningState ?? null;
  const learningFeatureEnabled = state ? isLearningFeatureEnabled(state.settings) : false;
  const activeQuizPrompt = learningFeatureEnabled ? learningState?.activeQuizPrompt ?? null : null;
  const storedQuizResult = learningFeatureEnabled ? learningState?.activeQuizResult ?? null : null;
  const activeQuizResult =
    storedQuizResult &&
    activeQuizPrompt &&
    storedQuizResult.prompt.questionId === activeQuizPrompt.questionId
      ? storedQuizResult
      : null;
  const displayedQuizSelectedChoiceId = activeQuizResult?.selectedChoiceId ?? quizSelectedChoiceId;

  useEffect(() => {
    setQuizSelectedChoiceId(null);
    setQuizHintVisible(false);
    setQuizAutoAdvanceSecsLeft(null);
    setQuizAutoAdvanceStartedAt(null);
    setQuizActionError(null);
    setQuizDifficultySelfRating(null);
  }, [activeQuizPrompt?.questionId]);

  useEffect(() => {
    if (!activeQuizResult) {
      setQuizAutoAdvanceSecsLeft(null);
      setQuizAutoAdvanceStartedAt(null);
      return;
    }
    const totalSecs = 20;
    const startedAt = quizAutoAdvanceStartedAt ?? Date.now();
    if (quizAutoAdvanceStartedAt === null) {
      setQuizAutoAdvanceStartedAt(startedAt);
    }
    const getRemainingSecs = () => {
      const elapsedMs = Date.now() - startedAt;
      return Math.max(0, Math.ceil((totalSecs * 1000 - elapsedMs) / 1000));
    };
    const initialRemainingSecs = getRemainingSecs();
    if (initialRemainingSecs <= 0) {
      void handleRequestQuizPrompt('retry');
      return;
    }
    setQuizAutoAdvanceSecsLeft(initialRemainingSecs);
    const interval = setInterval(() => {
      const remainingSecs = getRemainingSecs();
      setQuizAutoAdvanceSecsLeft(remainingSecs > 0 ? remainingSecs : null);
    }, 1000);
    const timeout = setTimeout(() => {
      void handleRequestQuizPrompt('retry');
    }, initialRemainingSecs * 1000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuizResult, quizAutoAdvanceStartedAt]);

  const handleRemoveExtendedAssignment = useCallback(async (calendarEventId: string) => {
    try {
      const res = await sendMessageAsync<{ ok: boolean; error?: string }>({
        type: 'REMOVE_EXTENDED_TASK_ASSIGNMENT',
        payload: { calendarEventId },
      });
      loadState();
      return { ok: res.ok, error: res.error };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, [loadState]);

  const popupSurfaceWidthPx =
    mode === 'popup' ? (taskDetailSelection ? POPUP_WIDTH_DETAIL_PX : POPUP_WIDTH_PX) : undefined;
  const persistentPanelControl = getPersistentPanelControl(
    mode,
    state?.settings.persistentPanelEnabled ?? false,
    isEmbedded,
  );

  const openLearningWorkspace = useCallback(() => {
    window.open(chrome.runtime.getURL('src/options/index.html#learning'), '_blank', 'noopener,noreferrer');
  }, []);

  const openAnalyticsWorkspace = useCallback(() => {
    window.open(chrome.runtime.getURL('src/options/index.html#analytics'), '_blank', 'noopener,noreferrer');
  }, []);

  const openCalendarWorkspace = useCallback(() => {
    window.open(chrome.runtime.getURL('src/options/index.html#calendar'), '_blank', 'noopener,noreferrer');
  }, []);

  const togglePersistentPanel = useCallback((enabled: boolean) => {
    chrome.runtime.sendMessage({ type: 'TOGGLE_PERSISTENT_PANEL', payload: { enabled } }, () => {
      loadState();
    });
  }, [loadState]);

  const startBreak = useCallback(async () => {
    setBreakActionError(null);
    setBreakStarting(true);
    try {
      await sendMessageAsync<{ ok: boolean }>({ type: 'SNOOZE' });
      loadState();
    } catch (err) {
      setBreakActionError(err instanceof Error ? err.message : 'Could not start break.');
    } finally {
      setBreakStarting(false);
    }
  }, [loadState]);

  const endBreak = useCallback(async () => {
    setBreakActionError(null);
    setEndBreakBusy(true);
    try {
      await sendMessageAsync<{ ok: boolean }>({ type: 'END_SNOOZE' });
      loadState();
    } catch (err) {
      setBreakActionError(err instanceof Error ? err.message : 'Could not end break.');
    } finally {
      setEndBreakBusy(false);
    }
  }, [loadState]);

  const handleCloseQuiz = useCallback(async () => {
    await sendMessageAsync<{ ok: boolean }>({
      type: 'SET_ACTIVE_QUIZ_VISIBILITY',
      payload: { visible: false },
    });
    setQuizSelectedChoiceId(null);
    setQuizHintVisible(false);
    loadState();
  }, [loadState]);

  const handleRequestQuizPrompt = useCallback(
    async (origin: 'manual' | 'retry' = 'manual') => {
      setQuizSelectedChoiceId(null);
      setQuizHintVisible(false);
      setQuizAutoAdvanceSecsLeft(null);
      setQuizAutoAdvanceStartedAt(null);
      setQuizActionError(null);
      try {
        await sendMessageAsync<{ ok: boolean; prompt: QuizPrompt | null }>({
          type: 'GET_NEXT_QUIZ_PROMPT',
          payload: {
            origin,
            excludeQuestionId: activeQuizPrompt?.questionId,
          },
        });
        loadState();
      } catch (err) {
        setQuizActionError(err instanceof Error ? err.message : 'Could not load the next question.');
      }
    },
    [activeQuizPrompt?.questionId, loadState],
  );

  const handleSubmitQuiz = useCallback(
    async (selectedChoiceId: string | null) => {
      if (!activeQuizPrompt || quizSubmitting) return;
      setQuizSubmitting(true);
      setQuizActionError(null);
      try {
        await sendMessageAsync<{ ok: boolean; result: QuizAnswerResult }>({
          type: 'SUBMIT_QUIZ_ANSWER',
          payload: {
            questionId: activeQuizPrompt.questionId,
            selectedChoiceId,
            sessionId: activeQuizPrompt.sessionId,
          },
        });
        loadState();
      } catch (err) {
        setQuizActionError(err instanceof Error ? err.message : 'Could not submit your answer.');
      } finally {
        setQuizSubmitting(false);
      }
    },
    [activeQuizPrompt, loadState, quizSubmitting],
  );

  const handleRateQuizDifficulty = useCallback(
    (rating: QuizDifficultySelfRating) => {
      setQuizDifficultySelfRating(rating);
      if (!activeQuizPrompt) return;
      void sendMessageAsync({ type: 'RATE_QUIZ_DIFFICULTY', payload: { questionId: activeQuizPrompt.questionId, rating } }).catch(() => undefined);
    },
    [activeQuizPrompt],
  );

  const handleToggleBlocking = () => {
    if (toggling || !state) return;
    setToggling(true);
    const nextEnabled = !state.settings.enableBlocking;
    chrome.runtime.sendMessage(
      { type: 'TOGGLE_BLOCKING', payload: { enabled: nextEnabled } },
      () => {
        setToggling(false);
        loadState();
      },
    );
  };

  if (loading) {
    return (
      <div
        style={
          mode === 'popup'
            ? {
                width: popupSurfaceWidthPx,
                minWidth: popupSurfaceWidthPx,
                minHeight: POPUP_MIN_HEIGHT_PX,
              }
            : undefined
        }
        className={`flex items-center justify-center bg-[var(--fg-bg)] text-sm text-[var(--fg-muted)] ${mode === 'panel' ? 'min-h-screen w-full' : 'h-[420px]'
          }`}
      >
        Loading Window…
      </div>
    );
  }

  if (!state) {
    return (
      <div
        style={
          mode === 'popup'
            ? {
                width: popupSurfaceWidthPx,
                minWidth: popupSurfaceWidthPx,
                minHeight: POPUP_MIN_HEIGHT_PX,
              }
            : undefined
        }
        className={`${mode === 'panel' ? 'min-h-screen w-full' : ''} bg-[var(--fg-bg)] p-4`}
      >
        <div className="fg-card p-4">
          <p className="text-[11px] uppercase tracking-wide text-rose-600">Window</p>
          <p className="mt-2 text-base font-semibold tracking-[-0.02em] text-[var(--fg-text)]">Unable to load the dashboard</p>
          <p className="mt-2 text-xs text-[var(--fg-muted)]">
            {loadError ?? 'The extension state is temporarily unavailable.'}
          </p>
        </div>
      </div>
    );
  }

  const {
    accountConflict,
    accountSyncState,
    accountUser,
    calendarState,
    settings,
    snoozeState,
    taskQueue,
    allTimeStats,
  } = state;
  const todaysEvents = Array.isArray(calendarState.todaysEvents) ? calendarState.todaysEvents : [];
  const popupTaskQueue = Array.isArray(taskQueue) ? taskQueue : [];
  const calendarConnected = calendarState.lastSyncedAt !== null && calendarState.authError === null;
  const blockingFeatureEnabled = isBlockingFeatureEnabled(settings);
  const quietHoursActive = isDailyBlockingPauseActive(new Date(), settings);
  const effectivelyBlocking = blockingFeatureEnabled && settings.enableBlocking && calendarState.isRestricted;
  const breakActive = snoozeState.active && !!snoozeState.expiresAt;
  const now = Date.now();
  const nextEvent =
    todaysEvents
      .filter((event) => new Date(event.start).getTime() > now)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0] ?? null;
  const actionableTasks = popupTaskQueue.filter((task) => task.status === 'active' || task.status === 'carryover');
  const selectedLearningTopics = learningState?.userTopics ?? [];
  const reviewQueue = learningState?.reviewQueue ?? [];
  const dueReviewCount = reviewQueue.filter((item) => new Date(item.dueAt).getTime() <= Date.now()).length;
  const readyLearningPacks = (learningState?.packs ?? []).filter((pack) => pack.status === 'ready');
  const quizOpen = learningFeatureEnabled && learningState?.activeQuizVisible === true && activeQuizPrompt !== null;

  const focusStatusMeta =
    calendarState.activeRuleSource === 'event' && calendarState.activeRuleName
      ? `Event rule: ${calendarState.activeRuleName}`
      : quietHoursActive
        ? `Daily cutoff active after ${formatBlockingPauseTimeLabel(settings.dailyBlockingPauseStartTime)}`
        : effectivelyBlocking
          ? 'Focus restrictions are active for this calendar block.'
          : 'No active restriction is limiting browsing right now.';

  const taskDetailAssignment =
    taskDetailSelection === null
      ? null
      : findExtendedTaskAssignment(
          taskDetailSelection.kind === 'task'
            ? taskDetailSelection.task.calendarEventId
            : taskDetailSelection.event.id,
          state.extendedTaskAssignments,
        );

  // In-page quiz panel (iframe injected on the active tab): a focused review
  // surface. The full dashboard stays in the popup and Chrome side panel.
  if (isEmbedded) {
    return (
      <div className="min-h-screen w-full overflow-x-hidden overflow-y-auto bg-[var(--fg-bg)] p-3 font-sans select-none">
        {!learningFeatureEnabled ? (
          <div className="fg-card p-4">
            <p className="text-sm font-semibold text-[var(--fg-text)]">Learning is turned off</p>
            <p className="mt-1 text-xs text-[var(--fg-muted)]">
              Enable the Learning feature in Window settings to review quizzes here.
            </p>
            <button
              type="button"
              onClick={() => void handleCloseQuiz()}
              className="fg-button-secondary mt-3 px-3 py-1.5 text-[11px]"
            >
              Close panel
            </button>
          </div>
        ) : activeQuizPrompt ? (
          <QuizCard
            mode="panel"
            prompt={activeQuizPrompt}
            result={activeQuizResult}
            errorMessage={quizActionError ?? learningState?.lastError ?? null}
            selectedChoiceId={displayedQuizSelectedChoiceId}
            hintVisible={quizHintVisible}
            submitting={quizSubmitting}
            difficultyRating={quizDifficultySelfRating}
            autoAdvanceSecsLeft={quizAutoAdvanceSecsLeft}
            onSelectChoice={setQuizSelectedChoiceId}
            onToggleHint={() => setQuizHintVisible((current) => !current)}
            onSubmit={() => void handleSubmitQuiz(quizSelectedChoiceId)}
            onGiveUp={() => void handleSubmitQuiz(null)}
            onMoreQuestions={() => void handleRequestQuizPrompt(activeQuizResult ? 'retry' : 'manual')}
            onOpenLearningWorkspace={openLearningWorkspace}
            onRateDifficulty={handleRateQuizDifficulty}
            onClose={() => void handleCloseQuiz()}
          />
        ) : (
          <div className="space-y-2">
            <ReviewHeroCard
              dueReviewCount={dueReviewCount}
              topics={selectedLearningTopics.map((topic) => topic.label)}
              readyPackCount={readyLearningPacks.length}
              weekStreak={allTimeStats.currentWeekStreak}
              errorMessage={quizActionError}
              busy={quizSubmitting}
              onStartReview={() => void handleRequestQuizPrompt('manual')}
              onOpenLearningWorkspace={openLearningWorkspace}
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void handleCloseQuiz()}
                className="fg-button-ghost px-2 py-1 text-[11px]"
              >
                Close panel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      style={
        mode === 'popup'
          ? {
              width: popupSurfaceWidthPx,
              minWidth: popupSurfaceWidthPx,
              maxWidth: popupSurfaceWidthPx,
              minHeight: POPUP_MIN_HEIGHT_PX,
            }
          : undefined
      }
      className={`${mode === 'panel' ? 'min-h-screen w-full' : 'max-h-[760px]'} overflow-x-hidden overflow-y-auto bg-[var(--fg-bg)] font-sans select-none`}
      data-embedded={isEmbedded || undefined}
    >
      <header className="sticky top-0 z-20 border-b border-[var(--fg-border)] bg-[var(--fg-bg)]/95 px-3 py-2 backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="text-sm font-semibold tracking-[-0.02em] text-[var(--fg-text)]">Window</h1>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                effectivelyBlocking
                  ? 'bg-emerald-50 text-emerald-700'
                  : breakActive
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-[var(--fg-panel-soft)] text-[var(--fg-muted)]'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  effectivelyBlocking ? 'bg-emerald-500' : breakActive ? 'bg-amber-500' : 'bg-slate-400'
                }`}
                aria-hidden="true"
              />
              {effectivelyBlocking ? 'Focus active' : breakActive ? 'On break' : 'Open browsing'}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <PointsBubble
              points={allTimeStats.totalPoints}
              level={allTimeStats.level}
              title={allTimeStats.title}
              compact
            />
            {persistentPanelControl === 'undock' && (
              <button
                type="button"
                onClick={() => togglePersistentPanel(false)}
                className="fg-button-ghost px-2 py-1 text-[11px]"
              >
                Undock
              </button>
            )}
            {persistentPanelControl === 'dock' && (
              <button
                type="button"
                onClick={() => togglePersistentPanel(true)}
                className="fg-button-ghost px-2 py-1 text-[11px]"
              >
                Dock
              </button>
            )}
            <AccountStatusControl
              accountUser={accountUser}
              accountSyncState={accountSyncState}
              accountConflict={accountConflict}
              calendarState={calendarState}
              onSignIn={() =>
                sendMessageAsync({ type: 'SIGN_IN_WITH_PROVIDER', payload: { provider: 'google' } }).then(loadState)
              }
              onRefresh={() =>
                sendMessageAsync({ type: 'REFRESH_ACCOUNT_STATE' }).then(loadState)
              }
              onSignOut={() =>
                sendMessageAsync({ type: 'SIGN_OUT_ACCOUNT' }).then(loadState)
              }
              onResolveConflict={(choice) =>
                sendMessageAsync({ type: 'RESOLVE_ACCOUNT_CONFLICT', payload: { choice } }).then(loadState)
              }
              onConnectCalendar={() =>
                sendMessageAsync({ type: 'CONNECT_CALENDAR' }).then(loadState)
              }
              onDisconnectCalendar={() =>
                sendMessageAsync({ type: 'DISCONNECT_CALENDAR' }).then(loadState)
              }
            />
          </div>
        </div>
      </header>

      <div className="space-y-2 px-3 py-2.5">
        {learningFeatureEnabled && quizOpen && activeQuizPrompt ? (
          <QuizCard
            mode={mode}
            prompt={activeQuizPrompt}
            result={activeQuizResult}
            errorMessage={quizActionError ?? learningState?.lastError ?? null}
            selectedChoiceId={displayedQuizSelectedChoiceId}
            hintVisible={quizHintVisible}
            submitting={quizSubmitting}
            difficultyRating={quizDifficultySelfRating}
            autoAdvanceSecsLeft={quizAutoAdvanceSecsLeft}
            onSelectChoice={setQuizSelectedChoiceId}
            onToggleHint={() => setQuizHintVisible((current) => !current)}
            onSubmit={() => void handleSubmitQuiz(quizSelectedChoiceId)}
            onGiveUp={() => void handleSubmitQuiz(null)}
            onMoreQuestions={() => void handleRequestQuizPrompt(activeQuizResult ? 'retry' : 'manual')}
            onOpenLearningWorkspace={openLearningWorkspace}
            onRateDifficulty={handleRateQuizDifficulty}
            onClose={() => void handleCloseQuiz()}
          />
        ) : learningFeatureEnabled ? (
          <ReviewHeroCard
            dueReviewCount={dueReviewCount}
            topics={selectedLearningTopics.map((topic) => topic.label)}
            readyPackCount={readyLearningPacks.length}
            weekStreak={allTimeStats.currentWeekStreak}
            errorMessage={quizActionError}
            busy={quizSubmitting}
            onStartReview={() => void handleRequestQuizPrompt('manual')}
            onOpenLearningWorkspace={openLearningWorkspace}
          />
        ) : null}

        <section className="fg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold tracking-[-0.02em] text-[var(--fg-text)]">Focus</h2>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-[var(--fg-muted)]">
                {!blockingFeatureEnabled ? 'Blocking feature off' : 'Blocking'}
              </span>
              <Toggle
                checked={blockingFeatureEnabled && settings.enableBlocking}
                disabled={toggling || !calendarConnected || !blockingFeatureEnabled}
                onChange={handleToggleBlocking}
              />
            </div>
          </div>

          <div className="mt-2 space-y-1">
            <CompactSettingRow
              label="Now"
              value={calendarState.currentEvent?.title ?? 'No focus block live'}
              meta={
                !calendarConnected
                  ? 'Connect Google Calendar from the account menu to turn on focus controls.'
                  : calendarState.currentEvent
                    ? `${formatEventRange(calendarState.currentEvent)} · ${focusStatusMeta}`
                    : focusStatusMeta
              }
              className="px-2 py-1"
            />

            <CompactSettingRow
              label="Next up"
              value={nextEvent?.title ?? 'Nothing queued'}
              meta={nextEvent ? formatEventRange(nextEvent) : 'You are clear after this block.'}
              className="px-2 py-1"
            />

            {breakActive && snoozeState.expiresAt ? (
              <div className="flex items-start justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-2 text-[11px] leading-snug text-amber-800">
                <p className="min-w-0 flex-1">
                  Break active. Blocking resumes in {formatCountdown(snoozeState.expiresAt)}.
                </p>
                <button
                  type="button"
                  onClick={() => void endBreak()}
                  disabled={endBreakBusy}
                  className="fg-button-secondary shrink-0 px-2 py-1 text-[11px] disabled:opacity-50"
                >
                  {endBreakBusy ? 'Ending…' : 'Resume'}
                </button>
              </div>
            ) : blockingFeatureEnabled ? (
              <div className="flex items-center justify-between gap-2 px-2 py-1">
                <p className="text-[11px] leading-snug text-[var(--fg-muted)]">
                  Need a breather? Pause blocking for {settings.breakDurationMinutes} minutes.
                </p>
                <button
                  type="button"
                  onClick={() => void startBreak()}
                  disabled={breakStarting}
                  className="fg-button-secondary shrink-0 px-2.5 py-1 text-[11px] disabled:opacity-50"
                >
                  {breakStarting ? 'Starting…' : 'Take a break'}
                </button>
              </div>
            ) : null}

            {breakActionError ? (
              <p className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-800">
                {breakActionError}
              </p>
            ) : null}

            {actionableTasks.length > 0 ? (
              <div className="space-y-1 pt-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--fg-muted)]">
                    Tasks
                  </p>
                  <button
                    onClick={() => setCompletionModalOpen(true)}
                    className="fg-button-primary px-2.5 py-1 text-[11px]"
                  >
                    Mark Task Done
                  </button>
                </div>
                <TaskQueue
                  tasks={actionableTasks}
                  extendedTaskAssignments={state.extendedTaskAssignments}
                  onSelectTask={(task) => setTaskDetailSelection({ kind: 'task', task })}
                />
              </div>
            ) : null}
          </div>
        </section>

        <div className="flex items-center justify-between px-1 pb-1">
          <button
            type="button"
            onClick={openCalendarWorkspace}
            className="fg-button-ghost px-2 py-1 text-[11px]"
          >
            Calendar workspace
          </button>
          <button
            type="button"
            onClick={openAnalyticsWorkspace}
            className="fg-button-ghost px-2 py-1 text-[11px]"
          >
            Analytics
          </button>
        </div>
      </div>

      {taskDetailSelection ? (
        <TaskDetailModal
          selection={taskDetailSelection}
          assignment={taskDetailAssignment}
          formatEventRange={formatEventRange}
          onClose={() => setTaskDetailSelection(null)}
          onRemoveAssignment={handleRemoveExtendedAssignment}
          onOpenWorkspace={openCalendarWorkspace}
        />
      ) : null}

      {completionModalOpen && actionableTasks.length > 0 && (
        <CompletionModal
          tasks={actionableTasks}
          onClose={() => setCompletionModalOpen(false)}
          onDone={() => {
            setCompletionModalOpen(false);
            loadState();
          }}
        />
      )}
    </div>
  );
}

function formatCountdown(expiresAt: string): string {
  const totalSeconds = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function formatEventRange(event: CalendarEvent): string {
  if (event.isAllDay) {
    const spanDays = Math.max(
      1,
      Math.round((new Date(event.end).getTime() - new Date(event.start).getTime()) / 86_400_000),
    );
    return spanDays > 1 ? `All day · ${spanDays} days` : 'All day';
  }

  return `${new Date(event.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${new Date(event.end).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

function isStateResponse(value: unknown): value is StateResponse {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<StateResponse>;
  return Boolean(
    candidate.settings &&
    candidate.calendarState &&
    candidate.allTimeStats &&
    candidate.assistantOptions &&
    candidate.ideaState &&
    candidate.openClawState &&
    Array.isArray(candidate.extendedTaskAssignments),
  );
}

function sendMessageAsync<T = unknown>(message: { type: string; payload?: unknown }): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T & { error?: string }) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (response && typeof response === 'object' && 'error' in response && response.error) {
        reject(new Error(String(response.error)));
        return;
      }

      resolve(response);
    });
  });
}
