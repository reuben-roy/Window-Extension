import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { TEMP_UNLOCK_DURATION_MINUTES } from '../shared/constants';
import PointsBubble from '../shared/components/PointsBubble';
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
}

const BREAK_DURATION_OPTIONS = [5, 10, 15] as const;

export default function Blocked(): React.JSX.Element {
  const [state, setState] = useState<StateResponse | null>(null);
  const [context, setContext] = useState<BlockedContextResponse | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<BreakDurationMinutes>(5);
  const [spending, setSpending] = useState(false);
  const [spendError, setSpendError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const loadState = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response: StateResponse) => {
      if (!chrome.runtime.lastError) setState(response);
    });

    chrome.runtime.sendMessage({ type: 'GET_BLOCKED_TAB_CONTEXT' }, (response: BlockedContextResponse) => {
      if (!chrome.runtime.lastError) setContext(response);
    });
  }, []);

  useEffect(() => {
    loadState();
    const listener = () => loadState();
    chrome.storage.onChanged.addListener(listener);
    const interval = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => {
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
      <div className="fg-shell min-h-screen flex items-center justify-center">
        <div className="fg-card px-6 py-5 text-sm text-[var(--fg-muted)]">Loading blocked page…</div>
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

  return (
    <div className="fg-shell min-h-screen px-4 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--fg-border)] bg-white/80 px-3 py-1 text-[11px] font-medium text-[var(--fg-muted)] shadow-sm">
              <span className="h-2 w-2 rounded-full bg-rose-400" />
              Focus checkpoint
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.03em] text-[var(--fg-text)]">
              Stay in the zone
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-[var(--fg-muted)]">
              {blockedHost
                ? `${blockedHost} is blocked during your current focus session.`
                : 'This site is blocked during your focus session.'}
            </p>
          </div>

          <PointsBubble
            points={allTimeStats.totalPoints}
            level={allTimeStats.level}
            title={allTimeStats.title}
          />
        </header>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr),minmax(320px,0.8fr)]">
          <div className="space-y-4">
            <div className="fg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--fg-muted)]">Current event</p>
                  <p className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-[var(--fg-text)]">
                    {currentEvent?.title ?? 'Focus block active'}
                  </p>
                  <p className="mt-1 text-sm text-[var(--fg-muted)]">
                    {currentEvent?.end
                      ? `Ends at ${formatClock(currentEvent.end)}`
                      : 'Blocking is active for your current focus rule.'}
                  </p>
                  <p className="mt-2 text-sm text-[var(--fg-muted)]">
                    {describeRuleSource(calendarState.activeRuleSource, calendarState.activeRuleName)}
                  </p>
                </div>

                <div className="grid min-w-[220px] grid-cols-2 gap-3">
                  <StatPill label="Tasks done" value={String(allTimeStats.tasksCompleted)} />
                  <StatPill label="Best week" value={`${allTimeStats.bestWeek} pts`} />
                  <StatPill label="Week streak" value={`${allTimeStats.currentWeekStreak}w`} />
                  <StatPill label="Leaderboard" value={`Lv ${allTimeStats.level}`} />
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="fg-card p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--fg-muted)]">Allowed right now</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {calendarState.allowedDomains.length > 0 ? (
                    calendarState.allowedDomains.map((domain) => (
                      <span key={domain} className="rounded-full border border-[var(--fg-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--fg-text)]">
                        {domain}
                      </span>
                    ))
                  ) : (
                    <p className="text-sm text-[var(--fg-muted)]">No allowed sites for this focus block.</p>
                  )}
                </div>
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
                          () => loadState(),
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

          <div className="space-y-4">
            <div className="fg-card p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--fg-muted)]">Temporary unlock</p>
              <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-[var(--fg-text)]">
                Spend points to peek at this site
              </p>
              <p className="mt-2 text-sm text-[var(--fg-muted)]">
                Unlock {blockedHost ?? 'this site'} for {TEMP_UNLOCK_DURATION_MINUTES} minutes in this tab only.
              </p>

              {context?.unlock && unlockCountdown ? (
                <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-emerald-600">Unlock active</p>
                  <p className="mt-1 text-3xl font-semibold tracking-[-0.03em] tabular-nums text-emerald-950">
                    {unlockCountdown}
                  </p>
                  <p className="mt-1 text-sm text-emerald-800">
                    This tab stays open until the timer ends, then blocking resumes automatically.
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
                      Costs increase each time you unlock another site during the same focus block.
                    </p>
                  </div>

                  {spendError && <p className="text-sm text-rose-600">{spendError}</p>}

                  <button
                    onClick={() => {
                      setSpending(true);
                      setSpendError(null);
                      chrome.runtime.sendMessage({ type: 'SPEND_POINTS_UNLOCK' }, (response: { ok: boolean; error?: string }) => {
                        setSpending(false);
                        if (!response?.ok) {
                          setSpendError(response?.error ?? 'Unable to unlock this site.');
                          loadState();
                        }
                      });
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
              <div className="mb-3">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--fg-muted)]">Leaderboard</p>
                <p className="mt-1 text-sm text-[var(--fg-muted)]">
                  A little pressure helps. Protect your score and stay ahead of the pack.
                </p>
              </div>

              <div className="space-y-2">
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

function StatPill({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-2xl border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-3">
      <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--fg-muted)]">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-[-0.03em] text-[var(--fg-text)]">{value}</p>
    </div>
  );
}

function describeRuleSource(
  source: 'event' | 'keyword' | 'none',
  name: string | null,
): string {
  if (source === 'event' && name) return `Using Event Rule "${name}".`;
  if (source === 'keyword' && name) return `Using keyword fallback "${name}".`;
  return 'Browsing would normally stay open when no rule matches.';
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

function buildMockLeaderboard(points: number, currentUser: string, level: number): Array<{
  rank: number;
  name: string;
  points: number;
  level: number;
  isCurrentUser: boolean;
}> {
  const sampleNames = ['Avery', 'Mina', 'Jonah', 'Priya', 'Mateo', 'Sora'];
  const candidates = [
    { name: sampleNames[0], points: points + 180, level: level + 2, isCurrentUser: false },
    { name: sampleNames[1], points: points + 95, level: level + 1, isCurrentUser: false },
    { name: sampleNames[2], points: points + 25, level, isCurrentUser: false },
    { name: currentUser, points, level, isCurrentUser: true },
    { name: sampleNames[3], points: Math.max(0, points - 40), level: Math.max(1, level - 1), isCurrentUser: false },
    { name: sampleNames[4], points: Math.max(0, points - 110), level: Math.max(1, level - 1), isCurrentUser: false },
  ];

  return candidates
    .sort((a, b) => b.points - a.points)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}
