import React from 'react';
import { xpRequiredForLevel } from '../../shared/constants';
import type { AllTimeStats } from '../../shared/types';

interface Props {
  stats: AllTimeStats;
}

export default function PointsDisplay({ stats }: Props): React.JSX.Element {
  const currentLevelXP = xpRequiredForLevel(stats.level);
  const nextLevelXP = xpRequiredForLevel(stats.level + 1);
  const xpIntoLevel = Math.max(0, stats.totalPoints - currentLevelXP);
  const xpNeeded = nextLevelXP - currentLevelXP;
  const progress = xpNeeded > 0 ? (xpIntoLevel / xpNeeded) * 100 : 100;

  return (
    <div className="rounded-lg border border-[var(--fg-border)] bg-white px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--fg-muted)]">
            Level progress
          </p>
          <div className="mt-1 flex flex-wrap items-end gap-x-1.5 gap-y-0.5">
            <span className="text-xl font-semibold tracking-[-0.03em] text-[var(--fg-text)]">
              {stats.totalPoints.toLocaleString()}
            </span>
            <span className="pb-0.5 text-[11px] font-medium uppercase tracking-wide text-[var(--fg-muted)]">
              pts
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-[var(--fg-muted)]">{stats.title}</p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="rounded-md bg-[var(--fg-accent-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-accent)]">
            Lv {stats.level}
          </span>
          {stats.currentWeekStreak > 0 && (
            <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              {stats.currentWeekStreak}w streak
            </span>
          )}
        </div>
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200/90">
        <div
          className="h-full rounded-full bg-[var(--fg-accent)] transition-all duration-500"
          style={{ width: `${Math.min(100, progress).toFixed(1)}%` }}
        />
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] tabular-nums text-[var(--fg-muted)]">
          {xpIntoLevel.toLocaleString()} / {xpNeeded.toLocaleString()} XP
        </span>
        <span className="text-[10px] font-medium text-[var(--fg-muted)]">
          {Math.round(progress)}% to Lv {stats.level + 1}
        </span>
      </div>
    </div>
  );
}
