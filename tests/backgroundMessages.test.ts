import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAllTimeStats, getBlockedTabs, getTemporaryUnlocks } from '../src/shared/storage';

let background: typeof import('../src/background/index');

describe('blocked page message handlers', () => {
  beforeAll(async () => {
    background = await import('../src/background/index');
    await Promise.resolve();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    chrome.storage.sync.clear();
    chrome.storage.local.clear();
  });

  it('loads blocked-tab context with an explicit tabId when sender.tab is missing', async () => {
    chrome.storage.sync.set({
      allTimeStats: {
        totalPoints: 100,
        level: 1,
        title: 'Novice',
        prestigeCount: 0,
        tasksCompleted: 0,
        bestWeek: 0,
        currentWeekStreak: 0,
      },
      calendarState: {
        currentEvent: null,
        allActiveEvents: [],
        todaysEvents: [],
        activeProfile: null,
        activeRuleSource: 'none',
        activeRuleName: null,
        allowedDomains: [],
        recentEventTitles: [],
        isRestricted: true,
        lastSyncedAt: null,
        authError: null,
      },
    });
    chrome.storage.local.set({
      blockedTabs: {
        '7': {
          tabId: 7,
          originalUrl: 'https://youtube.com/watch?v=demo',
          blockedHost: 'youtube.com',
          activeEventId: 'evt-1',
          activeEventTitle: 'Deep Work',
          blockedAt: '2026-04-12T18:00:00.000Z',
        },
      },
    });

    const response = await background.getBlockedTabContext(
      {} as chrome.runtime.MessageSender,
      { type: 'GET_BLOCKED_TAB_CONTEXT', payload: { tabId: 7 } },
    );

    expect(response.ok).toBe(true);
    expect(response.blockedTab?.tabId).toBe(7);
    expect(response.blockedTab?.blockedHost).toBe('youtube.com');
    expect(response.canSpend).toBe(true);
  });

  it('spends points and creates a temporary unlock with an explicit tabId', async () => {
    chrome.storage.sync.set({
      allTimeStats: {
        totalPoints: 100,
        level: 1,
        title: 'Novice',
        prestigeCount: 0,
        tasksCompleted: 0,
        bestWeek: 0,
        currentWeekStreak: 0,
      },
      pointsHistory: {},
      calendarState: {
        currentEvent: {
          id: 'evt-1',
          title: 'Deep Work',
          start: '2026-04-12T18:00:00.000Z',
          end: '2026-04-12T20:00:00.000Z',
          isAllDay: false,
        },
        allActiveEvents: [],
        todaysEvents: [],
        activeProfile: 'Deep Work',
        activeRuleSource: 'event',
        activeRuleName: 'Deep Work',
        allowedDomains: [],
        recentEventTitles: [],
        isRestricted: true,
        lastSyncedAt: '2026-04-12T18:00:00.000Z',
        authError: null,
      },
    });
    chrome.storage.local.set({
      blockedTabs: {
        '7': {
          tabId: 7,
          originalUrl: 'https://youtube.com/watch?v=demo',
          blockedHost: 'youtube.com',
          activeEventId: 'evt-1',
          activeEventTitle: 'Deep Work',
          blockedAt: '2026-04-12T18:00:00.000Z',
        },
      },
      temporaryUnlocks: {},
      unlockSpendState: {
        activeEventKey: null,
        spendCount: 0,
      },
    });

    const response = await background.spendPointsForTemporaryUnlock(
      {} as chrome.runtime.MessageSender,
      { type: 'SPEND_POINTS_UNLOCK', payload: { tabId: 7 } },
    );

    const [stats, blockedTabs, unlocks] = await Promise.all([
      getAllTimeStats(),
      getBlockedTabs(),
      getTemporaryUnlocks(),
    ]);

    expect(response.ok).toBe(true);
    expect(response.cost).toBe(25);
    expect(response.redirectUrl).toBe('https://youtube.com/watch?v=demo');
    expect(response.remainingPoints).toBe(75);
    expect(stats.totalPoints).toBe(75);
    expect(blockedTabs['7']).toBeUndefined();
    expect(unlocks['7']?.blockedHost).toBe('youtube.com');
  });
});
