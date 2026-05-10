import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getActiveFocusSession,
  getAnalyticsSnapshot,
  getCalendarState,
  getExtendedTaskAssignments,
  getExtendedTaskSets,
  getEventRules,
} from '../src/shared/storage';

function getStorageAreaValue<T>(
  area: chrome.storage.StorageArea,
  key: string,
): Promise<T | undefined> {
  return new Promise((resolve) => {
    area.get(key, (result) => resolve(result[key] as T | undefined));
  });
}

describe('storage normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chrome.storage.sync.clear();
    chrome.storage.local.clear();
  });

  it('normalizes legacy event rules from sync storage', async () => {
    chrome.storage.sync.set({
      eventRules: [
        {
          eventTitle: 'Deep Work',
          domains: ['github.com'],
        },
      ],
    });

    expect(await getEventRules()).toEqual([
      {
        eventTitle: 'Deep Work',
        domains: ['github.com'],
        tagKey: null,
        secondaryTagKeys: [],
        difficultyOverride: null,
      },
    ]);
  });

  it('normalizes legacy calendar state fields used by the options page', async () => {
    chrome.storage.sync.set({
      calendarState: {
        currentEvent: {
          id: 'evt-1',
          title: 'Deep Work',
          start: '2026-04-21T16:00:00.000Z',
          end: '2026-04-21T17:00:00.000Z',
          isAllDay: false,
        },
        allActiveEvents: [],
        todaysEvents: [],
        activeProfile: 'Deep Work',
        activeRuleSource: 'event',
        activeRuleName: 'Deep Work',
        primaryTagKey: 'coding',
        primaryTagLabel: 'Coding',
        allowedDomains: ['github.com'],
        recentEventTitles: ['Deep Work'],
        isRestricted: true,
        lastSyncedAt: '2026-04-21T16:00:00.000Z',
        authError: null,
      },
    });

    const state = await getCalendarState();
    expect(state.currentEvent?.description).toBeNull();
    expect(state.currentEvent?.attendees).toEqual([]);
    expect(state.secondaryTagKeys).toEqual([]);
    expect(state.secondaryTagLabels).toEqual([]);
  });

  it('normalizes legacy analytics records from local storage', async () => {
    chrome.storage.local.set({
      analyticsSnapshot: {
        summary7d: {
          range: '7d',
          productiveMinutes: 30,
          distractedMinutes: 5,
          awayMinutes: 0,
          breakMinutes: 0,
          totalFocusSessions: 1,
          leftEarlyCount: 0,
        },
        recentSessions: [
          {
            id: 'focus-1',
            calendarEventId: 'evt-1',
            eventTitle: 'Deep Work',
            scheduledStart: '2026-04-21T16:00:00.000Z',
            scheduledEnd: '2026-04-21T17:00:00.000Z',
            startedAt: '2026-04-21T16:00:00.000Z',
            endedAt: '2026-04-21T17:00:00.000Z',
            sourceRuleType: 'event',
            sourceRuleName: 'Deep Work',
            tagKey: 'coding',
            difficultyRank: 5,
            productiveMinutes: 30,
            supportiveMinutes: 5,
            distractedMinutes: 10,
            awayMinutes: 15,
            breakMinutes: 0,
            totalTrackedMinutes: 60,
            leftEarly: false,
          },
        ],
      },
      activeFocusSession: {
        id: 'focus-active',
        calendarEventId: 'evt-2',
        eventTitle: 'Research',
        scheduledStart: '2026-04-21T18:00:00.000Z',
        scheduledEnd: '2026-04-21T19:00:00.000Z',
        startedAt: '2026-04-21T18:00:00.000Z',
        endedAt: '2026-04-21T18:30:00.000Z',
        sourceRuleType: 'keyword',
        sourceRuleName: 'research',
        tagKey: 'research',
        difficultyRank: 3,
        productiveMinutes: 20,
        supportiveMinutes: 5,
        distractedMinutes: 5,
        awayMinutes: 0,
        breakMinutes: 0,
        totalTrackedMinutes: 30,
        leftEarly: false,
      },
    });

    const snapshot = await getAnalyticsSnapshot();
    const activeSession = await getActiveFocusSession();

    expect(snapshot.summary7d.supportiveMinutes).toBe(0);
    expect(snapshot.summary30d.totalFocusSessions).toBe(0);
    expect(snapshot.recentSessions[0].secondaryTagKeys).toEqual([]);
    expect(activeSession?.session.secondaryTagKeys).toEqual([]);
  });

  it('normalizes and migrates extended task sets and assignments from sync storage into local storage', async () => {
    chrome.storage.sync.set({
      extendedTaskSets: [
        {
          id: 'set-1',
          title: 'Late code sprint',
          items: [
            { id: 'item-1', label: 'Question 1', url: 'https://leetcode.com/q1' },
          ],
          createdAt: '2026-04-21T16:00:00.000Z',
          updatedAt: '2026-04-21T16:00:00.000Z',
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
            },
          ],
          createdAt: '2026-04-21T16:00:00.000Z',
          updatedAt: '2026-04-21T16:00:00.000Z',
        },
      ],
    });

    expect(await getStorageAreaValue(chrome.storage.local, 'extendedTaskSets')).toBeUndefined();
    expect(await getStorageAreaValue(chrome.storage.local, 'extendedTaskAssignments')).toBeUndefined();

    expect(await getExtendedTaskSets()).toEqual([
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
    ]);

    expect(await getStorageAreaValue(chrome.storage.sync, 'extendedTaskSets')).toBeUndefined();
    expect(await getStorageAreaValue(chrome.storage.local, 'extendedTaskSets')).toEqual([
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
    ]);

    expect(await getExtendedTaskAssignments()).toEqual([
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
    ]);

    expect(await getStorageAreaValue(chrome.storage.sync, 'extendedTaskAssignments')).toBeUndefined();
    expect(await getStorageAreaValue(chrome.storage.local, 'extendedTaskAssignments')).toEqual([
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
    ]);
  });
});
