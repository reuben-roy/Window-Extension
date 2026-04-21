import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeLaunchUrl,
  pruneExpiredEventLaunchTargets,
  resolveActiveLaunchTarget,
  upsertEventLaunchTarget,
} from '../src/shared/launchTargets';
import { getEventLaunchTargets, getEventRules } from '../src/shared/storage';
import type { CalendarEvent, EventLaunchTarget, EventRule } from '../src/shared/types';

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt-1',
    title: 'LeetCode',
    start: '2026-04-20T16:00:00.000Z',
    end: '2026-04-20T17:00:00.000Z',
    isAllDay: false,
    description: null,
    attendees: [],
    ...overrides,
  };
}

describe('launch target helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chrome.storage.sync.clear();
    chrome.storage.local.clear();
  });

  it('accepts valid http and https URLs', () => {
    expect(normalizeLaunchUrl('https://LeetCode.com/problems/two-sum')).toBe(
      'https://leetcode.com/problems/two-sum',
    );
    expect(normalizeLaunchUrl('http://example.com/path?q=1')).toBe(
      'http://example.com/path?q=1',
    );
  });

  it('rejects non-web URLs', () => {
    expect(normalizeLaunchUrl('chrome://extensions')).toBeNull();
    expect(normalizeLaunchUrl('mailto:test@example.com')).toBeNull();
  });

  it('normalizes consistently for save and reuse matching', () => {
    const normalized = normalizeLaunchUrl('https://leetcode.com/problems/two-sum/')!;
    expect(normalizeLaunchUrl(normalized)).toBe(normalized);
  });

  it('prunes expired launch targets after the retention window', () => {
    const activeTarget: EventLaunchTarget = {
      calendarEventId: 'active',
      eventTitle: 'Active',
      start: '2026-04-20T16:00:00.000Z',
      end: '2026-04-20T17:00:00.000Z',
      launchUrl: 'https://leetcode.com/problems/two-sum/',
      updatedAt: '2026-04-20T16:00:00.000Z',
    };
    const expiredTarget: EventLaunchTarget = {
      calendarEventId: 'expired',
      eventTitle: 'Expired',
      start: '2026-04-01T16:00:00.000Z',
      end: '2026-04-01T17:00:00.000Z',
      launchUrl: 'https://leetcode.com/problems/add-two-numbers/',
      updatedAt: '2026-04-01T16:00:00.000Z',
    };

    const pruned = pruneExpiredEventLaunchTargets(
      [activeTarget, expiredTarget],
      new Date('2026-04-20T18:00:00.000Z').getTime(),
    );

    expect(pruned).toEqual([activeTarget]);
  });

  it('saves launch targets without creating exact event rules', async () => {
    const existingRules: EventRule[] = [
      {
        eventTitle: 'Deep Work',
        domains: ['github.com'],
        tagKey: null,
        secondaryTagKeys: [],
        difficultyOverride: null,
      },
    ];
    chrome.storage.sync.set({ eventRules: existingRules });

    const result = await upsertEventLaunchTarget(
      makeEvent(),
      'https://leetcode.com/problems/two-sum/',
    );

    expect(result.ok).toBe(true);
    expect(await getEventRules()).toEqual(existingRules);

    const targets = await getEventLaunchTargets();
    expect(targets).toHaveLength(1);
    expect(targets[0].calendarEventId).toBe('evt-1');
    expect(targets[0].launchUrl).toBe('https://leetcode.com/problems/two-sum/');
  });

  it('picks the earliest-starting active occurrence that has a saved launch target', () => {
    const earlyEvent = makeEvent({
      id: 'early',
      start: '2026-04-20T16:00:00.000Z',
      end: '2026-04-20T17:00:00.000Z',
    });
    const lateEvent = makeEvent({
      id: 'late',
      start: '2026-04-20T16:30:00.000Z',
      end: '2026-04-20T17:30:00.000Z',
    });

    const target = resolveActiveLaunchTarget(
      [lateEvent, earlyEvent],
      [
        {
          calendarEventId: 'late',
          eventTitle: lateEvent.title,
          start: lateEvent.start,
          end: lateEvent.end,
          launchUrl: 'https://leetcode.com/problems/late/',
          updatedAt: '2026-04-20T16:00:00.000Z',
        },
        {
          calendarEventId: 'early',
          eventTitle: earlyEvent.title,
          start: earlyEvent.start,
          end: earlyEvent.end,
          launchUrl: 'https://leetcode.com/problems/early/',
          updatedAt: '2026-04-20T16:00:00.000Z',
        },
      ],
    );

    expect(target?.calendarEventId).toBe('early');
  });
});
