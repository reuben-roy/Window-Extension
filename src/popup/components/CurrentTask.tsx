import React, { useEffect, useState } from 'react';
import type { CalendarState } from '../../shared/types';

interface Props {
  calendarState: CalendarState;
  snoozeActive: boolean;
  blockingEnabled: boolean;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function formatTimeRemaining(endISO: string): string {
  const msLeft = Math.max(0, new Date(endISO).getTime() - Date.now());
  if (msLeft === 0) return 'Ended';
  const totalSecs = Math.ceil(msLeft / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}h ${m}m remaining`;
  if (m > 0) return `${m}m ${s}s remaining`;
  return `${s}s remaining`;
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CurrentTask({
  calendarState,
  snoozeActive,
  blockingEnabled,
}: Props): React.JSX.Element {
  // Tick every second to keep the countdown live
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!calendarState.currentEvent) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [calendarState.currentEvent?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const { currentEvent, activeProfile, isRestricted, authError } = calendarState;
  const effectivelyBlocking = blockingEnabled && isRestricted;

  // ── Auth error ────────────────────────────────────────────────────────────
  if (authError) {
    return (
      <div className="rounded-xl bg-red-50 border border-red-100 px-3 py-2.5">
        <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wide mb-0.5">
          Calendar error
        </p>
        <p className="text-xs text-red-600 leading-relaxed">{authError}</p>
        <p className="text-[10px] text-red-400 mt-1">
          Blocking is paused until the calendar reconnects.
        </p>
      </div>
    );
  }

  // ── Snooze active ─────────────────────────────────────────────────────────
  if (snoozeActive) {
    return (
      <div className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2.5">
        <p className="text-[10px] font-semibold text-amber-500 uppercase tracking-wide mb-0.5">
          Snooze active
        </p>
        {currentEvent ? (
          <p className="text-sm font-semibold text-amber-900 truncate">{currentEvent.title}</p>
        ) : (
          <p className="text-sm text-amber-800">Restrictions lifted temporarily</p>
        )}
        <p className="text-xs text-amber-600 mt-0.5">
          Blocking resumes when the snooze timer ends
        </p>
      </div>
    );
  }

  // ── No active event ───────────────────────────────────────────────────────
  if (!currentEvent) {
    // Carryover tasks are enforcing restrictions even without a live event
    if (effectivelyBlocking) {
      return (
        <div className="rounded-xl bg-orange-50 border border-orange-100 px-3 py-2.5">
          <p className="text-[10px] font-semibold text-orange-500 uppercase tracking-wide mb-0.5">
            Carryover restriction
          </p>
          <p className="text-sm font-medium text-orange-900">
            No active event — incomplete tasks restricting you
          </p>
          <p className="text-xs text-orange-600 mt-0.5">
            Mark tasks done below to restore unrestricted browsing
          </p>
        </div>
      );
    }

    return (
      <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">
          No active event
        </p>
        <p className="text-sm text-gray-600">
          {blockingEnabled ? 'Browsing is unrestricted' : 'Blocking is disabled'}
        </p>
      </div>
    );
  }

  // ── Active calendar event ─────────────────────────────────────────────────
  const timeRemaining = formatTimeRemaining(currentEvent.end);
  const endClock = formatClock(currentEvent.end);
  const ended = new Date(currentEvent.end).getTime() <= Date.now();

  const colorScheme = effectivelyBlocking
    ? {
        bg: 'bg-blue-50',
        border: 'border-blue-100',
        label: 'text-blue-400',
        title: 'text-blue-900',
        meta: 'text-blue-600',
        badge: 'bg-blue-100 text-blue-700',
        pill: 'bg-blue-100 text-blue-500',
      }
    : {
        bg: 'bg-emerald-50',
        border: 'border-emerald-100',
        label: 'text-emerald-400',
        title: 'text-emerald-900',
        meta: 'text-emerald-600',
        badge: 'bg-emerald-100 text-emerald-700',
        pill: 'bg-emerald-100 text-emerald-500',
      };

  return (
    <div className={`rounded-xl px-3 py-2.5 border ${colorScheme.bg} ${colorScheme.border}`}>
      {/* Label row */}
      <div className="flex items-center justify-between mb-0.5">
        <p className={`text-[10px] font-semibold uppercase tracking-wide ${colorScheme.label}`}>
          {effectivelyBlocking ? 'Blocking active' : activeProfile ? 'Not restricted' : 'No binding'}
        </p>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${colorScheme.pill}`}>
          until {endClock}
        </span>
      </div>

      {/* Event title */}
      <p className={`text-sm font-semibold truncate ${colorScheme.title}`}>{currentEvent.title}</p>

      {/* Time remaining + profile badge */}
      <div className="flex items-center justify-between mt-1">
        <p className={`text-xs tabular-nums ${colorScheme.meta}`}>
          {ended ? 'Block ended' : timeRemaining}
        </p>
        {activeProfile ? (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${colorScheme.badge}`}>
            {activeProfile}
          </span>
        ) : (
          <span className="text-[10px] text-gray-400">no profile → unrestricted</span>
        )}
      </div>
    </div>
  );
}
