import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TEMP_UNLOCK_DURATION_MINUTES, xpRequiredForLevel } from '../shared/constants';
import PointsBubble from '../shared/components/PointsBubble';
import { buildMockLeaderboard } from '../shared/mockLeaderboard';
import type {
  BlockedTabState,
  BreakDurationMinutes,
  StateResponse,
  TemporaryUnlockState,
} from '../shared/types';

interface BlockedContextResponse {
  ok: boolean;
  blockedTab: BlockedTabState | null;
  unlock: TemporaryUnlockState | null;
  nextUnlockCost: number;
  canSpend: boolean;
  error?: string;
}

interface UnlockSpendResponse {
  ok: boolean;
  error?: string;
  cost?: number;
  redirectUrl?: string;
  remainingPoints?: number;
}

interface UnlockSuccessState {
  cost: number;
  redirectUrl: string;
  remainingPoints?: number;
}

const BREAK_DURATION_OPTIONS = [5, 10, 15] as const;

export default function Blocked(): React.JSX.Element {
  const [state, setState] = useState<StateResponse | null>(null);
  const [context, setContext] = useState<BlockedContextResponse | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<BreakDurationMinutes>(5);
  const [spending, setSpending] = useState(false);
  const [spendError, setSpendError] = useState<string | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [unlockSuccess, setUnlockSuccess] = useState<UnlockSuccessState | null>(null);
  const currentTabIdRef = useRef<number | null>(null);
  const [, setTick] = useState(0);

  const loadState = useCallback((tabId: number | null = currentTabIdRef.current) => {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response: unknown) => {
      if (chrome.runtime.lastError) {
        setState(null);
        setStateError(chrome.runtime.lastError.message ?? 'Window could not load the blocked-page state.');
        return;
      }

      if (!isStateResponse(response)) {
        setState(null);
        setStateError('Window could not load the blocked-page state.');
        return;
      }

      setState(response);
      setStateError(null);
    });

    if (tabId === null) {
      setContext(null);
      setContextError('Blocked tab context is unavailable for this page.');
      return;
    }

    chrome.runtime.sendMessage(
      { type: 'GET_BLOCKED_TAB_CONTEXT', payload: { tabId } },
      (response: unknown) => {
        if (chrome.runtime.lastError) {
          setContext(null);
          setContextError(chrome.runtime.lastError.message ?? 'Window could not determine which blocked tab to restore.');
          return;
        }

        if (!isBlockedContextResponse(response)) {
          setContext(null);
          setContextError('Window could not determine which blocked tab to restore.');
          return;
        }

        setContext(response);
        setContextError(response.ok ? null : response.error ?? 'Blocked tab context is unavailable.');
      },
    );
  }, []);

  useEffect(() => {
    let cancelled = false;

    chrome.tabs.getCurrent((tab) => {
      if (cancelled) return;
      const nextTabId = tab?.id ?? null;
      currentTabIdRef.current = nextTabId;
      loadState(nextTabId);
    });

    const listener = () => loadState();
    chrome.storage.onChanged.addListener(listener);
    const interval = window.setInterval(() => setTick((value) => value + 1), 1000);

    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(listener);
      window.clearInterval(interval);
    };
  }, [loadState]);

  useEffect(() => {
    if (state) setSelectedDuration(state.settings.breakDurationMinutes);
  }, [state?.settings.breakDurationMinutes]);

  const blockedHost = useMemo(
    () => context?.blockedTab?.blockedHost ?? new URLSearchParams(window.location.search).get('blocked'),
    [context?.blockedTab?.blockedHost],
  );

  if (!state) {
    return (
      <div className="fg-shell min-h-screen px-4 py-8">
        <div className="mx-auto max-w-5xl">
          <StatusCard
            title={stateError ? 'Blocked page unavailable' : 'Loading your focus dashboard…'}
            body={
              stateError
                ? `${stateError} The page will keep trying as Window reconnects to the background service.`
                : 'Window is pulling your current event, points, and leaderboard data.'
            }
            tone={stateError ? 'error' : 'neutral'}
          />
        </div>
      </div>
    );
  }

  const { allTimeStats, backendSession, calendarState, snoozeState } = state;
  const currentEvent = calendarState.currentEvent;
  const breakActive = snoozeState.active && snoozeState.expiresAt !== null;
  const breakCountdown = breakActive && snoozeState.expiresAt ? formatCountdown(snoozeState.expiresAt) : null;
  const unlockCountdown = context?.unlock ? formatCountdown(context.unlock.expiresAt) : null;
  const leaderboard = buildMockLeaderboard(
    allTimeStats.totalPoints,
    backendSession?.userId ?? 'You',
    allTimeStats.level,
  );
  const currentEntry = leaderboard.find((entry) => entry.isCurrentUser) ?? null;
  const rankLabel = currentEntry ? `#${currentEntry.rank}` : 'Unranked';

  return (
    <div className="fg-shell min-h-screen px-4 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--fg-border)] bg-white/85 px-3 py-1 text-[11px] font-medium text-[var(--fg-muted)] shadow-sm">
            <span className="h-2 w-2 rounded-full bg-rose-400" />
            Focus checkpoint
          </div>
          <h1 className="text-3xl font-semibold tracking-[-0.03em] text-[var(--fg-text)]">
            Stay in the zone
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-[var(--fg-muted)]">
            {blockedHost
              ? `${blockedHost} is paused while your focus block is active.`
              : 'This site is paused while your focus block is active.'}
          </p>
        </header>

        <section className="relative grid items-start gap-4 lg:grid-cols-[minmax(0,1.18fr),360px]">
          <div className="pointer-events-none absolute right-[calc(360px+1rem)] top-[-5.5rem] z-20 hidden lg:block">
            <PointsBubble
              points={allTimeStats.totalPoints}
              level={allTimeStats.level}
              title={allTimeStats.title}
            />
          </div>

          <div className="space-y-4">
            <div className="fg-card relative overflow-visible p-5">
              <div className="mb-4 lg:hidden">
                <PointsBubble
                  points={allTimeStats.totalPoints}
                  level={allTimeStats.level}
                  title={allTimeStats.title}
                />
              </div>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--fg-muted)]">Current event</p>
                  <p className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-[var(--fg-text)]">
                    {currentEvent?.title ?? 'Focus block active'}
                  </p>
                  <p className="mt-1 text-sm text-[var(--fg-muted)]">
                    {currentEvent?.end
                      ? `Ends at ${formatClock(currentEvent.end)}`
                      : 'Blocking is active for your current focus rule.'}
                  </p>
                  <p className="mt-3 text-sm text-[var(--fg-muted)]">
                    You are currently {rankLabel}. Protect your lead, stack completions, and avoid cashing out more points than you need.
                  </p>
                </div>

                <LevelDial points={allTimeStats.totalPoints} level={allTimeStats.level} />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <InlineStat label="Rank" value={rankLabel} />
                <InlineStat label="Tasks done" value={String(allTimeStats.tasksCompleted)} />
                <InlineStat label="Best week" value={`${allTimeStats.bestWeek} pts`} />
                <InlineStat label="Week streak" value={`${allTimeStats.currentWeekStreak}w`} />
              </div>

              <div className="mt-5 border-t border-[var(--fg-border)] pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--fg-muted)]">Allowed right now</p>
                  <p className="text-xs text-[var(--fg-muted)]">
                    {calendarState.allowedDomains.length} domain{calendarState.allowedDomains.length === 1 ? '' : 's'}
                  </p>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {calendarState.allowedDomains.length > 0 ? (
                    calendarState.allowedDomains.map((domain) => (
                      <span
                        key={domain}
                        className="rounded-full border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-1.5 text-xs font-medium text-[var(--fg-text)]"
                      >
                        {domain}
                      </span>
                    ))
                  ) : (
                    <p className="text-sm text-[var(--fg-muted)]">No allowed sites for this focus block.</p>
                  )}
                </div>
              </div>

              {(unlockSuccess || contextError) && (
                <div
                  className={`mt-4 rounded-2xl border px-4 py-3 ${
                    unlockSuccess
                      ? 'border-violet-200 bg-violet-50'
                      : 'border-amber-200 bg-amber-50'
                  }`}
                >
                  {unlockSuccess ? (
                    <>
                      <p className="text-xs uppercase tracking-[0.16em] text-violet-700">Unlock purchased</p>
                      <p className="mt-1 text-sm text-violet-900">
                        Spent {unlockSuccess.cost} points. Your total and rank have been updated, and the site will reopen in this tab momentarily.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-xs uppercase tracking-[0.16em] text-amber-700">Context warning</p>
                      <p className="mt-1 text-sm text-amber-900">{contextError}</p>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="fg-card p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--fg-muted)]">Temporary unlock</p>
                <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-[var(--fg-text)]">
                  Spend points to peek at this site
                </p>
                <p className="mt-2 text-sm text-[var(--fg-muted)]">
                  Unlock {blockedHost ?? 'this site'} for {TEMP_UNLOCK_DURATION_MINUTES} minutes, even if you close and reopen it.
                </p>

                {context?.unlock && unlockCountdown ? (
                  <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-emerald-600">Unlock active</p>
                    <p className="mt-1 text-3xl font-semibold tracking-[-0.03em] tabular-nums text-emerald-950">
                      {unlockCountdown}
                    </p>
                    <p className="mt-1 text-sm text-emerald-800">
                      This site stays open until the timer ends, then Window will lock back in.
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 space-y-4">
                    <div className="rounded-2xl border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-[var(--fg-muted)]">Next unlock cost</p>
                      <p className="mt-1 text-3xl font-semibold tracking-[-0.03em] text-[var(--fg-text)]">
                        {context?.nextUnlockCost ?? 25} pts
                      </p>
                      <p className="mt-1 text-sm text-[var(--fg-muted)]">
                        Costs rise each time you buy another unlock during the same focus block.
                      </p>
                    </div>

                    {spendError && <p className="text-sm text-rose-600">{spendError}</p>}

                    <button
                      onClick={() => {
                        if (currentTabIdRef.current === null) {
                          setSpendError('Window could not resolve the blocked tab to unlock.');
                          return;
                        }

                        setSpending(true);
                        setSpendError(null);
                        setUnlockSuccess(null);
                        chrome.runtime.sendMessage(
                          { type: 'SPEND_POINTS_UNLOCK', payload: { tabId: currentTabIdRef.current } },
                          (response: UnlockSpendResponse | undefined) => {
                            setSpending(false);

                            if (!response?.ok || !response.redirectUrl) {
                              setSpendError(response?.error ?? 'Unable to unlock this site.');
                              loadState(currentTabIdRef.current);
                              return;
                            }

                            setUnlockSuccess({
                              cost: response.cost ?? context?.nextUnlockCost ?? 25,
                              redirectUrl: response.redirectUrl,
                              remainingPoints: response.remainingPoints,
                            });
                            loadState(currentTabIdRef.current);
                            window.setTimeout(() => {
                              window.location.assign(response.redirectUrl!);
                            }, 1100);
                          },
                        );
                      }}
                      disabled={spending || !context?.canSpend}
                      className="fg-button-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {spending
                        ? 'Unlocking…'
                        : context?.canSpend
                          ? `Spend ${context?.nextUnlockCost ?? 25} points`
                          : 'Not enough points'}
                    </button>
                  </div>
                )}
              </div>

              <div className="fg-card p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--fg-muted)]">Break timer</p>
                {breakActive && breakCountdown ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-4xl font-semibold tracking-[-0.03em] tabular-nums text-amber-950">{breakCountdown}</p>
                    <p className="text-sm text-amber-700">Blocking resumes automatically when your break ends.</p>
                  </div>
                ) : (
                  <div className="mt-3 space-y-4">
                    <div className="flex gap-2">
                      {BREAK_DURATION_OPTIONS.map((minutes) => (
                        <button
                          key={minutes}
                          onClick={() => setSelectedDuration(minutes)}
                          className={`flex-1 rounded-2xl px-3 py-2.5 text-sm font-medium transition-colors ${
                            selectedDuration === minutes
                              ? 'bg-[var(--fg-accent)] text-white shadow-[0_12px_24px_rgba(0,102,255,0.18)]'
                              : 'border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] text-[var(--fg-muted)] hover:bg-white'
                          }`}
                        >
                          {minutes} min
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        chrome.runtime.sendMessage(
                          { type: 'SNOOZE', payload: { durationMinutes: selectedDuration } },
                          () => loadState(currentTabIdRef.current),
                        );
                      }}
                      className="fg-button-secondary w-full"
                    >
                      Start {selectedDuration}-minute break
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex h-full flex-col lg:-mt-[7.5rem]">
            <div className="fg-card flex min-h-0 flex-1 flex-col p-5">
              <div className="mb-3">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--fg-muted)]">Leaderboard</p>
                <p className="mt-1 text-sm text-[var(--fg-muted)]">
                  Protect your score and stay ahead of the pack. Every unlock spend can move your position.
                </p>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto pr-1">
                {leaderboard.map((entry) => (
                  <div
                    key={entry.name}
                    className={`flex items-center justify-between rounded-2xl border px-3 py-3 ${
                      entry.isCurrentUser
                        ? 'border-violet-200 bg-violet-50'
                        : 'border-[var(--fg-border)] bg-[var(--fg-panel-soft)]'
                    }`}
                  >
                    <div>
                      <p className={`text-sm font-medium ${entry.isCurrentUser ? 'text-violet-900' : 'text-[var(--fg-text)]'}`}>
                        #{entry.rank} {entry.name}
                      </p>
                      <p className="text-xs text-[var(--fg-muted)]">Level {entry.level}</p>
                    </div>
                    <span className={`text-sm font-semibold ${entry.isCurrentUser ? 'text-violet-700' : 'text-[var(--fg-text)]'}`}>
                      {entry.points.toLocaleString()} pts
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function StatusCard({
  title,
  body,
  tone,
}: {
  title: string;
  body: string;
  tone: 'neutral' | 'error';
}): React.JSX.Element {
  return (
    <div className="fg-card px-6 py-5">
      <p className={`text-xs uppercase tracking-[0.16em] ${tone === 'error' ? 'text-rose-600' : 'text-[var(--fg-muted)]'}`}>
        Window
      </p>
      <p className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[var(--fg-text)]">{title}</p>
      <p className="mt-2 text-sm leading-6 text-[var(--fg-muted)]">{body}</p>
    </div>
  );
}

function InlineStat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-2">
      <span className="text-[11px] uppercase tracking-[0.16em] text-[var(--fg-muted)]">{label}</span>
      <span className="text-sm font-semibold text-[var(--fg-text)]">{value}</span>
    </div>
  );
}

function LevelDial({
  points,
  level,
}: {
  points: number;
  level: number;
}): React.JSX.Element {
  const currentLevelXP = xpRequiredForLevel(level);
  const nextLevelXP = xpRequiredForLevel(level + 1);
  const xpIntoLevel = Math.max(0, points - currentLevelXP);
  const xpNeeded = Math.max(1, nextLevelXP - currentLevelXP);
  const progress = Math.max(0, Math.min(1, xpIntoLevel / xpNeeded));
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const strokeOffset = circumference * (1 - progress);

  return (
    <div className="flex items-center gap-3 rounded-[26px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-4 py-3">
      <div className="relative h-[84px] w-[84px]">
        <svg viewBox="0 0 84 84" className="h-full w-full -rotate-90">
          <circle
            cx="42"
            cy="42"
            r={radius}
            fill="none"
            stroke="rgba(148, 163, 184, 0.28)"
            strokeWidth="8"
          />
          <circle
            cx="42"
            cy="42"
            r={radius}
            fill="none"
            stroke="url(#window-level-dial)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeOffset}
          />
          <defs>
            <linearGradient id="window-level-dial" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#7c3aed" />
              <stop offset="100%" stopColor="#2563eb" />
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--fg-muted)]">Lv</span>
          <span className="text-xl font-semibold tracking-[-0.03em] text-[var(--fg-text)]">{level}</span>
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-xs uppercase tracking-[0.16em] text-[var(--fg-muted)]">Next level</p>
        <p className="text-sm font-semibold text-[var(--fg-text)]">
          {xpIntoLevel.toLocaleString()} / {xpNeeded.toLocaleString()} XP
        </p>
        <p className="text-xs text-[var(--fg-muted)]">
          {Math.round(progress * 100)}% to Level {level + 1}
        </p>
      </div>
    </div>
  );
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatCountdown(expiresAt: string): string {
  const totalSeconds = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function isStateResponse(value: unknown): value is StateResponse {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<StateResponse>;
  return Boolean(
    candidate.settings &&
      candidate.allTimeStats &&
      candidate.calendarState &&
      candidate.taskQueue &&
      candidate.assistantOptions &&
      candidate.ideaState &&
      candidate.openClawState,
  );
}

function isBlockedContextResponse(value: unknown): value is BlockedContextResponse {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<BlockedContextResponse>;
  return (
    typeof candidate.ok === 'boolean' &&
    typeof candidate.nextUnlockCost === 'number' &&
    typeof candidate.canSpend === 'boolean'
  );
}
