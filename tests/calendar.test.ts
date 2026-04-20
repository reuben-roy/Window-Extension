import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchCalendarEventsInRange,
  findMatchingKeywordRule,
  getAllActiveEvents,
  getCurrentEvent,
  resolveActiveState,
  resolveRuleForEvent,
} from '../src/background/calendar';
import type {
  CalendarEvent,
  EventLaunchTarget,
  EventRule,
  KeywordRule,
  Settings,
} from '../src/shared/types';

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt-1',
    title: 'Deep Work',
    start: new Date(Date.now() - 30 * 60_000).toISOString(),
    end: new Date(Date.now() + 30 * 60_000).toISOString(),
    isAllDay: false,
    ...overrides,
  };
}

const DEFAULT_SETTINGS: Settings = {
  enableBlocking: true,
  blockPage: 'custom',
  carryoverMode: 'union',
  taskTTLDays: 7,
  monthlyResetEnabled: true,
  lastMonthlyReset: new Date().toISOString(),
  minBlockDurationMinutes: 15,
  breakDurationMinutes: 5,
  keywordAutoMatchEnabled: false,
  breakTelemetryEnabled: false,
  persistentPanelEnabled: false,
  dailyBlockingPauseEnabled: false,
  dailyBlockingPauseStartTime: '22:00',
  downloadRedirectFallbackSeconds: 2,
  downloadRedirectUseDownloadsApi: true,
  downloadRedirectFallbackPatternMatchEnabled: true,
  downloadRedirectFallbackSameHostEnabled: true,
  downloadRedirectFallbackSameSiteEnabled: true,
  downloadRedirectFallbackAnyAllowedRedirectEnabled: false,
  downloadRedirectAllowAcrossTabsEnabled: false,
  downloadRedirectProgrammaticDownloadEnabled: true,
};

const GLOBAL_ALLOWLIST = ['accounts.google.com'];
const EVENT_RULE = (eventTitle: string, domains: string[]): EventRule => ({
  eventTitle,
  domains,
  tagKey: null,
  difficultyOverride: null,
});
const KEYWORD_RULE = (keyword: string, domains: string[], createdAt: string): KeywordRule => ({
  keyword,
  domains,
  createdAt,
  tagKey: keyword,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getAllActiveEvents', () => {
  it('returns only active events', () => {
    const active = makeEvent();
    const future = makeEvent({
      id: 'future',
      start: new Date(Date.now() + 60 * 60_000).toISOString(),
      end: new Date(Date.now() + 120 * 60_000).toISOString(),
    });
    expect(getAllActiveEvents([active, future])).toEqual([active]);
  });
});

describe('getCurrentEvent', () => {
  it('returns the first active event or null', () => {
    const active = makeEvent({ id: 'a' });
    expect(getCurrentEvent([active])?.id).toBe('a');
    expect(getCurrentEvent([])).toBeNull();
  });
});

describe('findMatchingKeywordRule', () => {
  it('prefers the longest matching keyword', () => {
    const rules: KeywordRule[] = [
      KEYWORD_RULE('deep', ['github.com'], '2026-01-01T00:00:00.000Z'),
      KEYWORD_RULE('deep work', ['docs.google.com'], '2026-01-02T00:00:00.000Z'),
    ];
    expect(findMatchingKeywordRule('Morning Deep Work Session', rules)?.keyword).toBe('deep work');
  });

  it('breaks equal-length ties by earliest creation time', () => {
    const rules: KeywordRule[] = [
      KEYWORD_RULE('focus', ['github.com'], '2026-01-01T00:00:00.000Z'),
      KEYWORD_RULE('focus', ['docs.google.com'], '2026-01-02T00:00:00.000Z'),
    ];
    expect(findMatchingKeywordRule('Focus sprint', rules)?.domains).toEqual(['github.com']);
  });
});

describe('resolveRuleForEvent', () => {
  const eventRules: EventRule[] = [EVENT_RULE('Deep Work', ['github.com', 'claude.ai'])];
  const keywordRules: KeywordRule[] = [
    KEYWORD_RULE('study', ['arxiv.org'], '2026-01-01T00:00:00.000Z'),
  ];

  eventRules[0].tagKey = 'coding';
  eventRules[0].difficultyOverride = 5;
  keywordRules[0].tagKey = 'learning';

  it('uses exact event rules first', () => {
    const rule = resolveRuleForEvent(makeEvent(), eventRules, keywordRules, DEFAULT_SETTINGS);
    expect(rule?.source).toBe('event');
    expect(rule?.domains).toContain('github.com');
  });

  it('uses keyword fallback only when enabled', () => {
    const event = makeEvent({ title: 'Study Session' });
    expect(resolveRuleForEvent(event, [], keywordRules, DEFAULT_SETTINGS)).toBeNull();

    const rule = resolveRuleForEvent(event, [], keywordRules, {
      ...DEFAULT_SETTINGS,
      keywordAutoMatchEnabled: true,
    });
    expect(rule?.source).toBe('keyword');
    expect(rule?.name).toBe('study');
  });

  it('treats an exact rule copied from keyword fallback as keyword fallback', () => {
    const event = makeEvent({ title: 'Study Session' });
    const rule = resolveRuleForEvent(
      event,
      [EVENT_RULE('Study Session', ['github.com', 'arxiv.org'])],
      [KEYWORD_RULE('study', ['arxiv.org', 'github.com'], '2026-01-01T00:00:00.000Z')],
      { ...DEFAULT_SETTINGS, keywordAutoMatchEnabled: true },
    );

    expect(rule?.source).toBe('keyword');
    expect(rule?.name).toBe('study');
    expect(rule?.domains).toEqual(['arxiv.org', 'github.com']);
  });
});

describe('resolveActiveState', () => {
  const eventRules: EventRule[] = [
    EVENT_RULE('Deep Work', ['github.com', 'claude.ai']),
    EVENT_RULE('Pairing Block', ['github.com', 'linear.app']),
  ];
  const keywordRules: KeywordRule[] = [
    KEYWORD_RULE('study', ['arxiv.org', 'github.com'], '2026-01-01T00:00:00.000Z'),
  ];
  eventRules[0].tagKey = 'coding';
  eventRules[0].difficultyOverride = 5;
  keywordRules[0].tagKey = 'learning';

  it('stays unrestricted when no rules match', () => {
    const state = resolveActiveState(
      [makeEvent({ title: 'Team Meeting' })],
      eventRules,
      keywordRules,
      GLOBAL_ALLOWLIST,
      DEFAULT_SETTINGS,
    );
    expect(state.isRestricted).toBe(false);
    expect(state.activeRuleSource).toBe('none');
    expect(state.allowedDomains).toEqual([]);
  });

  it('activates blocking for an exact event rule', () => {
    const state = resolveActiveState(
      [makeEvent({ title: 'Deep Work' })],
      eventRules,
      keywordRules,
      GLOBAL_ALLOWLIST,
      DEFAULT_SETTINGS,
    );
    expect(state.isRestricted).toBe(true);
    expect(state.activeRuleSource).toBe('event');
    expect(state.activeRuleName).toBe('Deep Work');
    expect(state.primaryTagKey).toBe('coding');
    expect(state.difficultyRank).toBe(5);
    expect(state.allowedDomains).toContain('github.com');
    expect(state.allowedDomains).toContain('accounts.google.com');
  });

  it('pauses blocking after the configured daily cutoff time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-12T22:30:00'));

    const state = resolveActiveState(
      [makeEvent({ title: 'Deep Work' })],
      eventRules,
      keywordRules,
      GLOBAL_ALLOWLIST,
      {
        ...DEFAULT_SETTINGS,
        dailyBlockingPauseEnabled: true,
        dailyBlockingPauseStartTime: '22:00',
      },
    );

    expect(state.activeRuleSource).toBe('event');
    expect(state.isRestricted).toBe(false);
  });

  it('uses keyword fallback for unmatched events when enabled', () => {
    const state = resolveActiveState(
      [makeEvent({ title: 'Study Session' })],
      eventRules,
      keywordRules,
      GLOBAL_ALLOWLIST,
      { ...DEFAULT_SETTINGS, keywordAutoMatchEnabled: true },
    );
    expect(state.isRestricted).toBe(true);
    expect(state.activeRuleSource).toBe('keyword');
    expect(state.activeRuleName).toBe('study');
    expect(state.primaryTagKey).toBe('learning');
    expect(state.allowedDomains).toContain('arxiv.org');
  });

  it('stays unrestricted when an exact rule exists but has no domains', () => {
    const state = resolveActiveState(
      [makeEvent({ title: '113 Lab' })],
      [EVENT_RULE('113 Lab', [])],
      keywordRules,
      GLOBAL_ALLOWLIST,
      DEFAULT_SETTINGS,
    );
    expect(state.isRestricted).toBe(false);
    expect(state.activeRuleSource).toBe('none');
    expect(state.activeRuleName).toBeNull();
    expect(state.allowedDomains).toEqual([]);
  });

  it('uses an empty exact rule as an unrestricted override over keyword fallback', () => {
    const state = resolveActiveState(
      [makeEvent({ title: '113 Lab Study Session' })],
      [EVENT_RULE('113 Lab Study Session', [])],
      [KEYWORD_RULE('lab', ['github.com'], '2026-01-01T00:00:00.000Z')],
      GLOBAL_ALLOWLIST,
      { ...DEFAULT_SETTINGS, keywordAutoMatchEnabled: true },
    );
    expect(state.isRestricted).toBe(false);
    expect(state.activeRuleSource).toBe('none');
    expect(state.activeRuleName).toBeNull();
    expect(state.allowedDomains).toEqual([]);
  });

  it('prefers exact event rules over keyword fallback', () => {
    const state = resolveActiveState(
      [makeEvent({ title: 'Deep Work' })],
      [...eventRules, EVENT_RULE('Study Session', ['docs.google.com'])],
      [KEYWORD_RULE('deep', ['arxiv.org'], '2026-01-01T00:00:00.000Z')],
      GLOBAL_ALLOWLIST,
      { ...DEFAULT_SETTINGS, keywordAutoMatchEnabled: true },
    );
    expect(state.activeRuleSource).toBe('event');
    expect(state.allowedDomains).not.toContain('arxiv.org');
  });

  it('intersects overlapping matched rules', () => {
    const state = resolveActiveState(
      [
        makeEvent({ id: '1', title: 'Deep Work' }),
        makeEvent({ id: '2', title: 'Pairing Block' }),
      ],
      eventRules,
      keywordRules,
      GLOBAL_ALLOWLIST,
      DEFAULT_SETTINGS,
    );
    expect(state.allowedDomains).toContain('github.com');
    expect(state.allowedDomains).not.toContain('claude.ai');
    expect(state.allowedDomains).not.toContain('linear.app');
  });

  it('stays unrestricted when overlapping matched rules have no shared domains', () => {
    const state = resolveActiveState(
      [
        makeEvent({ id: '1', title: 'Deep Work' }),
        makeEvent({ id: '2', title: 'Pairing Block' }),
      ],
      [
        EVENT_RULE('Deep Work', ['claude.ai']),
        EVENT_RULE('Pairing Block', ['linear.app']),
      ],
      keywordRules,
      GLOBAL_ALLOWLIST,
      DEFAULT_SETTINGS,
    );
    expect(state.isRestricted).toBe(false);
    expect(state.activeRuleSource).toBe('none');
    expect(state.allowedDomains).toEqual([]);
  });

  it('ignores unmatched overlapping events and uses only matched ones', () => {
    const state = resolveActiveState(
      [
        makeEvent({ id: '1', title: 'Deep Work' }),
        makeEvent({ id: '2', title: 'Team Meeting' }),
      ],
      eventRules,
      keywordRules,
      GLOBAL_ALLOWLIST,
      DEFAULT_SETTINGS,
    );
    expect(state.isRestricted).toBe(true);
    expect(state.allowedDomains).toContain('claude.ai');
  });

  it('records recent event titles for the Event Rules UI', () => {
    const state = resolveActiveState(
      [makeEvent({ title: 'Deep Work' }), makeEvent({ id: '2', title: 'Team Meeting' })],
      eventRules,
      keywordRules,
      GLOBAL_ALLOWLIST,
      DEFAULT_SETTINGS,
    );
    expect(state.recentEventTitles).toEqual(expect.arrayContaining(['Deep Work', 'Team Meeting']));
  });

  it('resolves the active launch target for the earliest active occurrence with a saved URL', () => {
    const launchTargets: EventLaunchTarget[] = [
      {
        calendarEventId: '2',
        eventTitle: 'Study Session',
        start: new Date(Date.now() - 10 * 60_000).toISOString(),
        end: new Date(Date.now() + 30 * 60_000).toISOString(),
        launchUrl: 'https://leetcode.com/problems/two-sum/',
        updatedAt: '2026-04-15T16:00:00.000Z',
      },
      {
        calendarEventId: '1',
        eventTitle: 'Deep Work',
        start: new Date(Date.now() - 20 * 60_000).toISOString(),
        end: new Date(Date.now() + 20 * 60_000).toISOString(),
        launchUrl: 'https://github.com/reubenroy/window-extension',
        updatedAt: '2026-04-15T16:00:00.000Z',
      },
    ];

    const state = resolveActiveState(
      [
        makeEvent({ id: '2', title: 'Study Session', start: launchTargets[0].start, end: launchTargets[0].end }),
        makeEvent({ id: '1', title: 'Deep Work', start: launchTargets[1].start, end: launchTargets[1].end }),
      ],
      eventRules,
      keywordRules,
      GLOBAL_ALLOWLIST,
      DEFAULT_SETTINGS,
      [],
      [],
      launchTargets,
    );

    expect(state.activeLaunchTarget?.calendarEventId).toBe('1');
    expect(state.activeLaunchTarget?.launchUrl).toBe('https://github.com/reubenroy/window-extension');
  });

  it('implicitly allows the active launch target host while blocking is active', () => {
    const event = makeEvent({ id: 'launch-1', title: 'Deep Work' });
    const launchTargets: EventLaunchTarget[] = [
      {
        calendarEventId: 'launch-1',
        eventTitle: event.title,
        start: event.start,
        end: event.end,
        launchUrl: 'https://leetcode.com/problems/two-sum/',
        updatedAt: '2026-04-15T16:00:00.000Z',
      },
    ];

    const state = resolveActiveState(
      [event],
      eventRules,
      keywordRules,
      GLOBAL_ALLOWLIST,
      DEFAULT_SETTINGS,
      [],
      [],
      launchTargets,
    );

    expect(state.isRestricted).toBe(true);
    expect(state.allowedDomains).toContain('leetcode.com');
  });
});

describe('fetchCalendarEventsInRange', () => {
  it('maps Google event colors when the palette resolves colorId', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                id: 'evt-1',
                summary: 'Deep Work',
                colorId: '11',
                start: { dateTime: '2026-04-12T13:00:00.000Z' },
                end: { dateTime: '2026-04-12T15:00:00.000Z' },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            event: {
              '11': { background: '#616161', foreground: '#ffffff' },
            },
          }),
          { status: 200 },
        ),
      );

    const events = await fetchCalendarEventsInRange(
      'token',
      '2026-04-12T00:00:00.000Z',
      '2026-04-13T00:00:00.000Z',
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events[0]).toMatchObject({
      googleColorId: '11',
      backgroundColor: '#616161',
      foregroundColor: '#ffffff',
      colorSource: 'google-event',
    });
  });

  it('derives a fallback color when Google colorId is missing', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                id: 'evt-1',
                summary: 'Deep Work 2',
                start: { dateTime: '2026-04-12T13:00:00.000Z' },
                end: { dateTime: '2026-04-12T15:00:00.000Z' },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ event: {} }), { status: 200 }));

    const events = await fetchCalendarEventsInRange(
      'token',
      '2026-04-12T00:00:00.000Z',
      '2026-04-13T00:00:00.000Z',
    );

    expect(events[0].colorSource).toBe('derived');
    expect(events[0].backgroundColor).toBeTruthy();
    expect(events[0].foregroundColor).toBe('#ffffff');
  });

  it('falls back safely when the colors endpoint fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                id: 'evt-1',
                summary: 'Phoenix Run Club',
                colorId: '7',
                start: { dateTime: '2026-04-12T19:00:00.000Z' },
                end: { dateTime: '2026-04-12T20:00:00.000Z' },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response('oops', { status: 500, statusText: 'Server Error' }));

    const events = await fetchCalendarEventsInRange(
      'token',
      '2026-04-12T00:00:00.000Z',
      '2026-04-13T00:00:00.000Z',
    );

    expect(events[0].colorSource).toBe('derived');
    expect(events[0].backgroundColor).toBeTruthy();
    expect(warnSpy).toHaveBeenCalled();
  });
});
