import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLaunchExecutionStates } from '../src/shared/storage';
import type { CalendarState, EventLaunchTarget } from '../src/shared/types';

let background: typeof import('../src/background/index');

function makeLaunchTarget(overrides: Partial<EventLaunchTarget> = {}): EventLaunchTarget {
  return {
    calendarEventId: 'evt-1',
    eventTitle: 'LeetCode',
    start: new Date(Date.now() - 15 * 60_000).toISOString(),
    end: new Date(Date.now() + 45 * 60_000).toISOString(),
    launchUrl: 'https://leetcode.com/problems/two-sum/',
    updatedAt: '2026-04-20T16:00:00.000Z',
    ...overrides,
  };
}

function makeCalendarState(target: EventLaunchTarget | null): CalendarState {
  return {
    currentEvent: target
      ? {
          id: target.calendarEventId,
          title: target.eventTitle,
          start: target.start,
          end: target.end,
          isAllDay: false,
        }
      : null,
    activeLaunchTarget: target,
    allActiveEvents: target && target.start && target.end
      ? [
          {
            id: target.calendarEventId,
            title: target.eventTitle,
            start: target.start,
            end: target.end,
            isAllDay: false,
          },
        ]
      : [],
    todaysEvents: [],
    activeProfile: null,
    activeRuleSource: 'none',
    activeRuleName: null,
    primaryTagKey: null,
    primaryTagLabel: null,
    difficultyRank: null,
    allowedDomains: [],
    recentEventTitles: [],
    isRestricted: false,
    lastSyncedAt: new Date().toISOString(),
    authError: null,
  };
}

describe('auto-launch behavior', () => {
  beforeAll(async () => {
    background = await import('../src/background/index');
    await Promise.resolve();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    chrome.storage.sync.clear();
    chrome.storage.local.clear();
    (chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (chrome.tabs.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 99,
      url: 'https://leetcode.com/problems/two-sum/',
      active: true,
      windowId: 1,
    });
    (chrome.tabs.update as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (chrome.windows.update as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('focuses an existing matching tab instead of creating a duplicate', async () => {
    const target = makeLaunchTarget();
    (chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 14,
        url: target.launchUrl,
        windowId: 3,
      },
    ]);

    await background.maybeAutoLaunchActiveOccurrence(makeCalendarState(target));

    expect(chrome.windows.update).toHaveBeenCalledWith(3, { focused: true });
    expect(chrome.tabs.update).toHaveBeenCalledWith(14, { active: true });
    expect(chrome.tabs.create).not.toHaveBeenCalled();

    const states = await getLaunchExecutionStates();
    expect(states[target.calendarEventId]?.status).toBe('focused');
    expect(states[target.calendarEventId]?.tabId).toBe(14);
  });

  it('creates a new tab when no matching tab exists', async () => {
    const target = makeLaunchTarget();

    await background.maybeAutoLaunchActiveOccurrence(makeCalendarState(target));

    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: target.launchUrl,
      active: true,
    });

    const states = await getLaunchExecutionStates();
    expect(states[target.calendarEventId]?.status).toBe('created');
    expect(states[target.calendarEventId]?.tabId).toBe(99);
  });

  it('does not reopen the same occurrence after it has already been handled', async () => {
    const target = makeLaunchTarget();

    await background.maybeAutoLaunchActiveOccurrence(makeCalendarState(target));
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);

    (chrome.tabs.create as ReturnType<typeof vi.fn>).mockClear();
    (chrome.tabs.query as ReturnType<typeof vi.fn>).mockClear();

    await background.maybeAutoLaunchActiveOccurrence(makeCalendarState(target));

    expect(chrome.tabs.query).not.toHaveBeenCalled();
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('records failed launches and does not retry them automatically', async () => {
    const target = makeLaunchTarget();
    (chrome.tabs.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('tab creation failed'),
    );

    await background.maybeAutoLaunchActiveOccurrence(makeCalendarState(target));

    const states = await getLaunchExecutionStates();
    expect(states[target.calendarEventId]?.status).toBe('failed');

    (chrome.tabs.create as ReturnType<typeof vi.fn>).mockClear();
    await background.maybeAutoLaunchActiveOccurrence(makeCalendarState(target));

    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('manually opens the active launch target from stored calendar state', async () => {
    const target = makeLaunchTarget();
    chrome.storage.sync.set({
      calendarState: makeCalendarState(target),
    });

    const response = await background.openActiveLaunchTarget();

    expect(response.ok).toBe(true);
    expect(response.status).toBe('created');
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: target.launchUrl,
      active: true,
    });
  });
});
