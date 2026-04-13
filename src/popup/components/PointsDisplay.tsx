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
    <div className="rounded-[20px] border border-[var(--fg-border)] bg-[var(--fg-panel-soft)] px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-[11px] font-bold text-[var(--fg-text)]">Lv {stats.level}</span>
          <span className="text-[10px] text-slate-300">·</span>
          <span className="truncate text-[10px] text-[var(--fg-muted)]">{stats.title}</span>
          {stats.currentWeekStreak > 0 && (
            <>
              <span className="text-[10px] text-slate-300">·</span>
              <span className="text-[10px] font-semibold text-violet-600">
                {stats.currentWeekStreak}w streak
              </span>
            </>
          )}
        </div>
        <span className="text-sm font-bold tabular-nums text-[var(--fg-text)]">
          {stats.totalPoints.toLocaleString()} pts
        </span>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-gradient-to-r from-violet-600 to-blue-500 transition-all duration-500"
          style={{ width: `${Math.min(100, progress).toFixed(1)}%` }}
        />
      </div>

      <div className="mt-1 flex items-center justify-between">
        <span className="text-[10px] tabular-nums text-[var(--fg-muted)]">
          {xpIntoLevel.toLocaleString()} / {xpNeeded.toLocaleString()} XP
        </span>
        <span className="text-[10px] text-[var(--fg-muted)]">
          → Lv {stats.level + 1}
        </span>
      </div>
    </div>
  );
}
