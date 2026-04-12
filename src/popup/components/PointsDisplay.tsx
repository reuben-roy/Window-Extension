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
    <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5">
      {/* Level + pts row */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold text-gray-800">Lv {stats.level}</span>
          <span className="text-[10px] text-gray-300">·</span>
          <span className="text-[10px] text-gray-500">{stats.title}</span>
          {stats.currentWeekStreak > 0 && (
            <>
              <span className="text-[10px] text-gray-300">·</span>
              <span className="text-[10px] text-orange-500 font-semibold">
                🔥 {stats.currentWeekStreak}w
              </span>
            </>
          )}
        </div>
        <span className="text-xs font-bold text-gray-700 tabular-nums">
          {stats.totalPoints.toLocaleString()} pts
        </span>
      </div>

      {/* XP bar */}
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all duration-500"
          style={{ width: `${Math.min(100, progress).toFixed(1)}%` }}
        />
      </div>

      {/* XP sub-label row */}
      <div className="flex items-center justify-between mt-1">
        <span className="text-[10px] text-gray-400 tabular-nums">
          {xpIntoLevel.toLocaleString()} / {xpNeeded.toLocaleString()} XP
        </span>
        <span className="text-[10px] text-gray-400">
          → Lv {stats.level + 1}
        </span>
      </div>
    </div>
  );
}
