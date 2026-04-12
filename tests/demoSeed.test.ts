import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_ALL_TIME_STATS, ensureDemoStatsSeeded } from '../src/background/demoSeed';
import {
  getAllTimeStats,
  getDemoStatsSeedVersion,
  getPointsHistory,
} from '../src/shared/storage';

describe('ensureDemoStatsSeeded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chrome.storage.sync.clear();
    chrome.storage.local.clear();
  });

  it('seeds untouched users with demo stats and non-empty history', async () => {
    const seeded = await ensureDemoStatsSeeded();

    const [stats, history, version] = await Promise.all([
      getAllTimeStats(),
      getPointsHistory(),
      getDemoStatsSeedVersion(),
    ]);

    expect(seeded).toBe(true);
    expect(stats).toEqual(DEMO_ALL_TIME_STATS);
    expect(version).toBe(1);
    expect(Object.keys(history)).toHaveLength(3);
    expect(Object.values(history).every((week) => week.earned > 0)).toBe(true);
  });

  it('does not overwrite real progress once a profile has been used', async () => {
    chrome.storage.sync.set({
      allTimeStats: {
        totalPoints: 88,
        level: 1,
        title: 'Novice',
        prestigeCount: 0,
        tasksCompleted: 2,
        bestWeek: 88,
        currentWeekStreak: 1,
      },
      pointsHistory: {
        '2026-W10': {
          earned: 88,
          tasksCompleted: 2,
          tasksDismissed: 0,
          tasksExpired: 0,
          snoozesUsed: 0,
          perfectDays: 0,
          longestStreak: 0,
        },
      },
    });

    const seeded = await ensureDemoStatsSeeded();
    const [stats, version] = await Promise.all([
      getAllTimeStats(),
      getDemoStatsSeedVersion(),
    ]);

    expect(seeded).toBe(false);
    expect(stats.totalPoints).toBe(88);
    expect(stats.tasksCompleted).toBe(2);
    expect(version).toBe(1);
  });
});
