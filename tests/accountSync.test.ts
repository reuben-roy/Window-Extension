import { beforeEach, describe, expect, it } from 'vitest';
import {
  accountSnapshotHasUserData,
  applyAccountSnapshotToStorage,
  areAccountSnapshotsEqual,
  buildAccountSnapshotFromStorage,
  createEmptyAccountSnapshot,
  normalizeAccountSnapshot,
} from '../src/shared/account';

describe('account snapshot helpers', () => {
  beforeEach(() => {
    chrome.storage.sync.clear();
    chrome.storage.local.clear();
  });

  it('builds a normalized snapshot from sync storage', async () => {
    chrome.storage.sync.set({
      allTimeStats: {
        totalPoints: 120,
        level: 3,
        title: 'Focused',
        prestigeCount: 0,
        tasksCompleted: 12,
        bestWeek: 80,
        currentWeekStreak: 2,
      },
      pointsHistory: {
        '2026-W15': {
          earned: 80,
          tasksCompleted: 4,
          tasksDismissed: 0,
          tasksExpired: 0,
          snoozesUsed: 1,
          perfectDays: 1,
          longestStreak: 2,
        },
      },
      profiles: {
        'Deep Work': ['github.com', 'docs.google.com'],
      },
      eventBindings: {
        research: 'Deep Work',
      },
      eventRules: [{ eventTitle: 'Deep Work', domains: ['github.com'] }],
      keywordRules: [
        {
          keyword: 'research',
          domains: ['arxiv.org'],
          createdAt: '2026-04-12T18:00:00.000Z',
        },
      ],
      globalAllowlist: ['accounts.google.com', 'calendar.google.com'],
    });

    const snapshot = await buildAccountSnapshotFromStorage();

    expect(snapshot.allTimeStats.totalPoints).toBe(120);
    expect(snapshot.pointsHistory['2026-W15']?.earned).toBe(80);
    expect(snapshot.profiles['Deep Work']).toEqual(['docs.google.com', 'github.com']);
    expect(snapshot.globalAllowlist).toEqual(['accounts.google.com', 'calendar.google.com']);
    expect(accountSnapshotHasUserData(snapshot)).toBe(true);
  });

  it('applies a remote snapshot into sync storage', async () => {
    const snapshot = normalizeAccountSnapshot({
      allTimeStats: {
        totalPoints: 45,
        level: 2,
        title: 'Apprentice',
        prestigeCount: 0,
        tasksCompleted: 3,
        bestWeek: 45,
        currentWeekStreak: 1,
      },
      pointsHistory: {
        '2026-W15': {
          earned: 45,
          tasksCompleted: 3,
          tasksDismissed: 0,
          tasksExpired: 0,
          snoozesUsed: 0,
          perfectDays: 0,
          longestStreak: 1,
        },
      },
      profiles: {
        Writing: ['docs.google.com'],
      },
      eventBindings: {},
      eventRules: [],
      keywordRules: [],
      globalAllowlist: ['accounts.google.com'],
    });

    await applyAccountSnapshotToStorage(snapshot);
    const rebuilt = await buildAccountSnapshotFromStorage();

    expect(areAccountSnapshotsEqual(rebuilt, snapshot)).toBe(true);
  });

  it('treats the default empty snapshot as no user data', () => {
    expect(accountSnapshotHasUserData(createEmptyAccountSnapshot())).toBe(false);
  });
});
