import React, { useEffect, useState } from 'react';
import { getAllTimeStats, getCurrentWeekStats } from '../../shared/storage';
import type { AllTimeStats, WeeklyStats } from '../../shared/types';

export default function Stats(): React.JSX.Element {
  const [allTime, setAllTime] = useState<AllTimeStats | null>(null);
  const [thisWeek, setThisWeek] = useState<WeeklyStats | null>(null);

  useEffect(() => {
    Promise.all([getAllTimeStats(), getCurrentWeekStats()]).then(([a, w]) => {
      setAllTime(a);
      setThisWeek(w);
    });
  }, []);

  if (!allTime || !thisWeek) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="space-y-6">
      <h2 className="text-base font-semibold text-gray-900">Stats</h2>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="This week" value={`${thisWeek.earned} pts`} />
        <StatCard label="Total points" value={allTime.totalPoints.toLocaleString()} />
        <StatCard label="Tasks completed" value={String(allTime.tasksCompleted)} />
        <StatCard label="Current level" value={`${allTime.level} · ${allTime.title}`} />
        <StatCard label="Week streak" value={`${allTime.currentWeekStreak}w`} />
        <StatCard label="Best week" value={`${allTime.bestWeek} pts`} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">This week</h3>
        <div className="space-y-2">
          <StatRow label="Completed" value={thisWeek.tasksCompleted} />
          <StatRow label="Dismissed" value={thisWeek.tasksDismissed} />
          <StatRow label="Expired" value={thisWeek.tasksExpired} />
          <StatRow label="Snoozes used" value={thisWeek.snoozesUsed} />
          <StatRow label="Perfect days" value={thisWeek.perfectDays} />
        </div>
      </div>

      <p className="text-xs text-gray-400 text-center">
        Full analytics dashboard unlocks at Level 8.
      </p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className="text-sm font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-800">{value}</span>
    </div>
  );
}
