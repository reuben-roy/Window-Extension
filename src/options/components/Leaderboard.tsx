import React, { useEffect, useState } from 'react';
import { getAllTimeStats, getPointsHistory, getWeekKey } from '../../shared/storage';
import type { AllTimeStats, PointsHistory } from '../../shared/types';

export default function Leaderboard(): React.JSX.Element {
  const [history, setHistory] = useState<PointsHistory>({});
  const [allTime, setAllTime] = useState<AllTimeStats | null>(null);

  useEffect(() => {
    Promise.all([getPointsHistory(), getAllTimeStats()]).then(([h, a]) => {
      setHistory(h);
      setAllTime(a);
    });
  }, []);

  const weeks = Object.entries(history)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 8);

  const currentWeekKey = getWeekKey();
  const recentPoints = weeks.slice(0, 4).map(([, w]) => w.earned);
  const avg4Week =
    recentPoints.length > 0
      ? Math.round(recentPoints.reduce((s, v) => s + v, 0) / recentPoints.length)
      : 0;
  const thisWeekEarned = history[currentWeekKey]?.earned ?? 0;

  if (!allTime) return <p className="text-sm text-gray-400">Loading…</p>;

  const leaderboardUnlocked = allTime.level >= 15;

  return (
    <div className="space-y-6">
      <h2 className="text-base font-semibold text-gray-900">Leaderboard</h2>

      {thisWeekEarned > 0 && avg4Week > 0 && (
        <div className="bg-blue-50 rounded-xl px-4 py-3 text-sm text-blue-800">
          {thisWeekEarned >= avg4Week
            ? `You scored ${thisWeekEarned} pts this week, beating your 4-week average of ${avg4Week}.`
            : `You scored ${thisWeekEarned} pts this week vs. your 4-week average of ${avg4Week}.`}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {weeks.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-6 italic">No weekly data yet</p>
        )}
        {weeks.map(([weekKey, stats]) => (
          <div key={weekKey} className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-sm font-medium text-gray-800">{weekKey}</p>
              <p className="text-xs text-gray-400">{stats.tasksCompleted} tasks completed</p>
            </div>
            <span className="text-sm font-semibold text-gray-900">{stats.earned} pts</span>
          </div>
        ))}
      </div>

      {!leaderboardUnlocked && (
        <p className="text-xs text-gray-400 text-center">
          Friend group leaderboard unlocks at Level 15.
        </p>
      )}
    </div>
  );
}
