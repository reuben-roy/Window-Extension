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
      eventRules: [{ eventTitle: 'Deep Work', domains: ['github.com'], tagKey: null, difficultyOverride: null }],
      keywordRules: [
        {
          keyword: 'research',
          domains: ['arxiv.org'],
          createdAt: '2026-04-12T18:00:00.000Z',
          tagKey: 'research',
        },
      ],
      extendedTaskSets: [
        {
          id: 'set-1',
          title: 'Late code sprint',
          items: [
            { id: 'item-1', label: 'Question 1', url: 'https://leetcode.com/q1' },
          ],
          createdAt: '2026-04-21T16:00:00.000Z',
          updatedAt: '2026-04-21T16:00:00.000Z',
          archivedAt: null,
        },
      ],
      extendedTaskAssignments: [
        {
          id: 'assignment-1',
          calendarEventId: 'evt-1',
          eventTitle: 'Late code sprint',
          start: '2026-04-21T16:00:00.000Z',
          end: '2026-04-21T17:00:00.000Z',
          setId: 'set-1',
          setTitle: 'Late code sprint',
          items: [
            {
              id: 'assignment-item-1',
              label: 'Question 1',
              url: 'https://leetcode.com/q1',
              completedAt: null,
            },
          ],
          createdAt: '2026-04-21T16:00:00.000Z',
          updatedAt: '2026-04-21T16:00:00.000Z',
        },
      ],
      globalAllowlist: ['accounts.google.com', 'calendar.google.com'],
    });

    const snapshot = await buildAccountSnapshotFromStorage();

    expect(snapshot.allTimeStats.totalPoints).toBe(120);
    expect(snapshot.pointsHistory['2026-W15']?.earned).toBe(80);
    expect(snapshot.profiles['Deep Work']).toEqual(['docs.google.com', 'github.com']);
    expect(snapshot.extendedTaskSets).toHaveLength(1);
    expect(snapshot.extendedTaskAssignments).toHaveLength(1);
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
      extendedTaskSets: [
        {
          id: 'set-1',
          title: 'Late code sprint',
          items: [
            { id: 'item-1', label: 'Question 1', url: 'https://leetcode.com/q1' },
          ],
          createdAt: '2026-04-21T16:00:00.000Z',
          updatedAt: '2026-04-21T16:00:00.000Z',
          archivedAt: null,
        },
      ],
      extendedTaskAssignments: [
        {
          id: 'assignment-1',
          calendarEventId: 'evt-1',
          eventTitle: 'Late code sprint',
          start: '2026-04-21T16:00:00.000Z',
          end: '2026-04-21T17:00:00.000Z',
          setId: 'set-1',
          setTitle: 'Late code sprint',
          items: [
            {
              id: 'assignment-item-1',
              label: 'Question 1',
              url: 'https://leetcode.com/q1',
              completedAt: null,
            },
          ],
          createdAt: '2026-04-21T16:00:00.000Z',
          updatedAt: '2026-04-21T16:00:00.000Z',
        },
      ],
      globalAllowlist: ['accounts.google.com'],
    });

    await applyAccountSnapshotToStorage(snapshot);
    const rebuilt = await buildAccountSnapshotFromStorage();

    expect(areAccountSnapshotsEqual(rebuilt, snapshot)).toBe(true);
  });

  it('treats the default empty snapshot as no user data', () => {
    expect(accountSnapshotHasUserData(createEmptyAccountSnapshot())).toBe(false);
  });

  it('does not include built-in roadmap templates in account snapshots unless the user duplicates them', async () => {
    const snapshot = await buildAccountSnapshotFromStorage();

    expect(snapshot.extendedTaskSets).toEqual([]);
    expect(snapshot.extendedTaskAssignments).toEqual([]);
    expect(snapshot.extendedTaskSets.find((taskSet) => taskSet.id === 'leetcode-150-master')).toBeUndefined();
  });
});
