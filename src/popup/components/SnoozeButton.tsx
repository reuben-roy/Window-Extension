import React, { useEffect, useState } from 'react';
import type { SnoozeState } from '../../shared/types';

interface Props {
  snoozeState: SnoozeState;
  /** Whether blocking is currently active (enabled + restricted). */
  isRestricted: boolean;
  /** Number of active/carryover tasks — needed to know if there's something to snooze. */
  taskCount: number;
  /** ID of the first active/carryover task — used as the snooze target. */
  activeTaskId: string | null;
}

function formatCountdown(expiresAt: string): string {
  const sLeft = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const m = Math.floor(sLeft / 60);
  const s = sLeft % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function SnoozeButton({
  snoozeState,
  isRestricted,
  taskCount,
  activeTaskId,
}: Props): React.JSX.Element | null {
  const [, setTick] = useState(0);

  const isActive = snoozeState.active && snoozeState.expiresAt !== null;

  // Live countdown while snooze is running
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isActive]);

  // ── Active snooze countdown ───────────────────────────────────────────────
  if (isActive && snoozeState.expiresAt) {
    const countdown = formatCountdown(snoozeState.expiresAt);
    return (
      <div className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-amber-700">Snooze active</p>
          <p className="text-[10px] text-amber-500 mt-0.5">Blocking resumes when timer ends</p>
        </div>
        <span className="text-xl font-mono font-bold text-amber-600 tabular-nums flex-shrink-0">
          {countdown}
        </span>
      </div>
    );
  }

  // Hide when nothing to snooze (not restricted and no tasks)
  if (!isRestricted && taskCount === 0) return null;

  const snoozesLeft = snoozeState.maxSnoozes - snoozeState.snoozesUsed;

  // ── No snoozes left ───────────────────────────────────────────────────────
  if (snoozesLeft <= 0) {
    return (
      <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2">
        <p className="text-xs text-gray-400 text-center">
          No snoozes remaining for this task
        </p>
      </div>
    );
  }

  // ── Snooze available ──────────────────────────────────────────────────────
  return (
    <button
      className="w-full py-2 border border-gray-200 text-gray-700 text-sm rounded-xl hover:bg-gray-50 active:bg-gray-100 transition-colors flex items-center justify-center gap-2"
      onClick={() => {
        if (activeTaskId) {
          chrome.runtime.sendMessage({ type: 'SNOOZE', payload: { taskId: activeTaskId } });
        }
      }}
    >
      <span>Snooze 5 min</span>
      <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full font-medium">
        {snoozesLeft} left
      </span>
    </button>
  );
}
