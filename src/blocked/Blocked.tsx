import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BREAK_DURATION_OPTIONS } from '../shared/constants';
import type { BreakDurationMinutes, StateResponse } from '../shared/types';

export default function Blocked(): React.JSX.Element {
  const [state, setState] = useState<StateResponse | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<BreakDurationMinutes>(5);

  const loadState = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response: StateResponse) => {
      if (!chrome.runtime.lastError) setState(response);
    });
  }, []);

  useEffect(() => {
    loadState();
    const poll = setInterval(loadState, 1000);
    return () => clearInterval(poll);
  }, [loadState]);

  useEffect(() => {
    if (state) setSelectedDuration(state.settings.breakDurationMinutes);
  }, [state?.settings.breakDurationMinutes]);

  const blockedHost = useMemo(
    () => new URLSearchParams(window.location.search).get('blocked'),
    [],
  );

  if (!state) {
    return (
      <div className="fg-shell min-h-screen flex items-center justify-center">
        <div className="fg-card px-6 py-5 text-sm text-[var(--fg-muted)]">Loading blocked page…</div>
      </div>
    );
  }

  const { calendarState, snoozeState } = state;
  const currentEvent = calendarState.currentEvent;
  const breakActive = snoozeState.active && snoozeState.expiresAt !== null;
  const countdown = breakActive && snoozeState.expiresAt ? formatCountdown(snoozeState.expiresAt) : null;

  return (
    <div className="fg-shell min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center space-y-2">
          <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-[24px] border border-[var(--fg-border)] bg-white shadow-[var(--fg-shadow)]">
            <span className="text-3xl">⏳</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-[-0.03em] text-[var(--fg-text)]">You&apos;re supposed to be focused</h1>
          <p className="text-sm text-[var(--fg-muted)]">
            {blockedHost ? `Blocked site: ${blockedHost}` : 'This site is blocked during your focus event.'}
          </p>
        </div>

        <div className="fg-card px-5 py-5 space-y-2">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--fg-muted)]">Current event</p>
          <p className="text-xl font-semibold tracking-[-0.03em] text-[var(--fg-text)]">{currentEvent?.title ?? 'Focus block active'}</p>
          {currentEvent?.end && (
            <p className="text-sm text-[var(--fg-muted)]">Ends at {formatClock(currentEvent.end)}</p>
          )}
          <p className="text-sm text-[var(--fg-muted)]">{describeRuleSource(calendarState.activeRuleSource, calendarState.activeRuleName)}</p>
        </div>

        {breakActive && countdown ? (
          <div className="fg-card px-5 py-5 space-y-2 border-amber-200 bg-[linear-gradient(180deg,rgba(255,251,235,0.96),rgba(255,255,255,0.88))]">
            <p className="text-xs uppercase tracking-[0.18em] text-amber-600">Break active</p>
            <p className="text-4xl font-semibold tracking-[-0.03em] tabular-nums text-amber-950">{countdown}</p>
            <p className="text-sm text-amber-800">Blocking will resume automatically when the timer ends.</p>
          </div>
        ) : (
          <div className="fg-card px-5 py-5 space-y-4">
            <div>
              <p className="mb-2 text-xs uppercase tracking-[0.18em] text-[var(--fg-muted)]">Take a break</p>
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
            </div>

            <button
              onClick={() => {
                chrome.runtime.sendMessage(
                  { type: 'SNOOZE', payload: { durationMinutes: selectedDuration } },
                  () => loadState(),
                );
              }}
              className="fg-button-primary w-full"
            >
              Start {selectedDuration}-minute break
            </button>
          </div>
        )}

        {calendarState.allowedDomains.length > 0 && (
          <div className="fg-card px-5 py-5">
            <p className="mb-3 text-xs uppercase tracking-[0.18em] text-[var(--fg-muted)]">Allowed during this event</p>
            <div className="flex flex-wrap gap-2">
              {calendarState.allowedDomains.map((domain) => (
                <span key={domain} className="rounded-full border border-[var(--fg-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--fg-text)]">
                  {domain}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
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
