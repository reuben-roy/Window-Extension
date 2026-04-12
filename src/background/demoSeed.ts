import type { AllTimeStats, PointsHistory, WeeklyStats } from '../shared/types';
import {
  getAllTimeStats,
  getDemoStatsSeedVersion,
  getPointsHistory,
  getWeekKey,
  setAllTimeStats,
  setDemoStatsSeedVersion,
  setPointsHistory,
} from '../shared/storage';

export const DEMO_STATS_SEED_VERSION = 1;

export const DEMO_ALL_TIME_STATS: AllTimeStats = {
  totalPoints: 1240,
  level: 5,
  title: 'Disciplined',
  prestigeCount: 0,
  tasksCompleted: 42,
  bestWeek: 340,
  currentWeekStreak: 3,
};

function makeWeek(earned: number, tasksCompleted: number): WeeklyStats {
  return {
    earned,
    tasksCompleted,
    tasksDismissed: 0,
    tasksExpired: 0,
    snoozesUsed: 0,
    perfectDays: 0,
    longestStreak: 0,
  };
}

export function buildDemoPointsHistory(now: Date = new Date()): PointsHistory {
  const thisWeek = new Date(now);
  const lastWeek = new Date(now);
  lastWeek.setDate(lastWeek.getDate() - 7);
  const twoWeeksAgo = new Date(now);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  return {
    [getWeekKey(thisWeek)]: makeWeek(180, 6),
    [getWeekKey(lastWeek)]: makeWeek(240, 8),
    [getWeekKey(twoWeeksAgo)]: makeWeek(340, 11),
  };
}

export function isUntouchedStatsProfile(
  stats: AllTimeStats,
  history: PointsHistory,
): boolean {
  return (
    stats.totalPoints === 0 &&
    stats.level === 1 &&
    stats.title === 'Novice' &&
    stats.prestigeCount === 0 &&
    stats.tasksCompleted === 0 &&
    stats.bestWeek === 0 &&
    stats.currentWeekStreak === 0 &&
    Object.keys(history).length === 0
  );
}

export async function ensureDemoStatsSeeded(): Promise<boolean> {
  const [seedVersion, stats, history] = await Promise.all([
    getDemoStatsSeedVersion(),
    getAllTimeStats(),
    getPointsHistory(),
  ]);

  if (seedVersion >= DEMO_STATS_SEED_VERSION) {
    return false;
  }

  if (!isUntouchedStatsProfile(stats, history)) {
    await setDemoStatsSeedVersion(DEMO_STATS_SEED_VERSION);
    return false;
  }

  await Promise.all([
    setAllTimeStats(DEMO_ALL_TIME_STATS),
    setPointsHistory(buildDemoPointsHistory()),
    setDemoStatsSeedVersion(DEMO_STATS_SEED_VERSION),
  ]);

  return true;
}
