import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAnalyticsSnapshot,
  classifyActivityDomain,
  createEmptyFocusSession,
  deriveDifficultyRank,
  summarizeFocusSession,
} from '../src/shared/analytics';
import { DEFAULT_TASK_TAGS } from '../src/shared/constants';
import { ensureRuleMetadata, observeEventPatterns } from '../src/shared/tags';
import type {
  ActivitySessionRecord,
  CalendarState,
  EventRule,
  FocusSessionRecord,
  KeywordRule,
} from '../src/shared/types';

const BASE_CALENDAR_STATE: CalendarState = {
  currentEvent: {
    id: 'evt-1',
    title: 'Deep Work',
    start: '2026-04-15T16:00:00.000Z',
    end: '2026-04-15T18:00:00.000Z',
    isAllDay: false,
  },
  activeLaunchTarget: null,
  allActiveEvents: [],
  todaysEvents: [],
  activeProfile: 'Deep Work',
  activeRuleSource: 'event',
  activeRuleName: 'Deep Work',
  primaryTagKey: 'coding',
  primaryTagLabel: 'Coding',
  difficultyRank: 5,
  allowedDomains: ['github.com'],
  recentEventTitles: [],
  isRestricted: true,
  lastSyncedAt: '2026-04-15T16:00:00.000Z',
  authError: null,
};

afterEach(() => {
  vi.useRealTimers();
});

describe('tag metadata migration', () => {
  it('adds tag keys to legacy keyword rules and creates matching tags', () => {
    const eventRules: EventRule[] = [
      { eventTitle: 'Deep Work', domains: ['github.com'], tagKey: null, difficultyOverride: null },
    ];
    const keywordRules: KeywordRule[] = [
      { keyword: 'research', domains: ['arxiv.org'], createdAt: '2026-04-15T16:00:00.000Z', tagKey: null },
    ];

    const result = ensureRuleMetadata(eventRules, keywordRules, []);

    expect(result.keywordRules[0].tagKey).toBe('research');
    expect(result.taskTags.some((tag) => tag.key === 'research')).toBe(true);
  });

  it('preserves null difficultyOverride and does not mark rule as changed', () => {
    const eventRules: EventRule[] = [
      { eventTitle: 'Calling Friends', domains: ['leetcode.com'], tagKey: null, difficultyOverride: null },
    ];

    const result = ensureRuleMetadata(eventRules, [], []);

    expect(result.eventRules[0].difficultyOverride).toBeNull();
    expect(result.changed).toBe(false);
  });

  it('auto-creates a tag after the same pattern appears three times', () => {
    const observed = observeEventPatterns(
      ['Quarterly planning sprint', 'Quarterly planning sprint', 'Quarterly planning sprint'],
      [],
      DEFAULT_TASK_TAGS,
    );

    expect(observed.taskTags.some((tag) => tag.key === 'quarterly-planning-sprint')).toBe(true);
  });
});

describe('activity classification', () => {
  const codingTag = DEFAULT_TASK_TAGS.find((tag) => tag.key === 'coding')!;

  it('marks allowed domains as aligned', () => {
    expect(
      classifyActivityDomain({
        domain: 'github.com',
        calendarState: BASE_CALENDAR_STATE,
        tag: codingTag,
        snoozed: false,
        idle: false,
      }),
    ).toBe('aligned');
  });

  it('marks supportive domains as supportive', () => {
    expect(
      classifyActivityDomain({
        domain: 'developer.mozilla.org',
        calendarState: BASE_CALENDAR_STATE,
        tag: codingTag,
        snoozed: false,
        idle: false,
      }),
    ).toBe('supportive');
  });

  it('marks unrelated domains as distracted', () => {
    expect(
      classifyActivityDomain({
        domain: 'news.ycombinator.com',
        calendarState: BASE_CALENDAR_STATE,
        tag: codingTag,
        snoozed: false,
        idle: false,
      }),
    ).toBe('distracted');
  });
});

describe('difficulty and session summaries', () => {
  it('raises difficulty for long sessions with distracting history', () => {
    const prior: FocusSessionRecord[] = [
      {
        id: 'focus-1',
        calendarEventId: 'evt-old',
        eventTitle: 'Deep Work',
        scheduledStart: '2026-04-14T16:00:00.000Z',
        scheduledEnd: '2026-04-14T18:00:00.000Z',
        startedAt: '2026-04-14T16:00:00.000Z',
        endedAt: '2026-04-14T18:00:00.000Z',
        sourceRuleType: 'event',
        sourceRuleName: 'Deep Work',
        tagKey: 'coding',
        difficultyRank: 5,
        productiveMinutes: 40,
        supportiveMinutes: 10,
        distractedMinutes: 45,
        awayMinutes: 5,
        breakMinutes: 0,
        totalTrackedMinutes: 100,
        leftEarly: false,
      },
    ];

    expect(
      deriveDifficultyRank({
        baselineDifficulty: 3,
        scheduledStart: '2026-04-15T16:00:00.000Z',
        scheduledEnd: '2026-04-15T18:30:00.000Z',
        priorSessions: prior,
        override: null,
      }),
    ).toBe(5);
  });

  it('marks a focus session as left early after a long productive gap', () => {
    const session = createEmptyFocusSession('focus-2', BASE_CALENDAR_STATE, '2026-04-15T16:00:00.000Z')!;
    const activities: ActivitySessionRecord[] = [
      {
        id: 'act-1',
        focusSessionId: session.id,
        calendarEventId: session.calendarEventId,
        eventTitle: session.eventTitle,
        domain: 'github.com',
        startedAt: '2026-04-15T16:00:00.000Z',
        endedAt: '2026-04-15T16:50:00.000Z',
        activityClass: 'aligned',
        tagKey: 'coding',
        difficultyRank: 5,
        sourceRuleType: 'event',
        sourceRuleName: 'Deep Work',
      },
      {
        id: 'act-2',
        focusSessionId: session.id,
        calendarEventId: session.calendarEventId,
        eventTitle: session.eventTitle,
        domain: null,
        startedAt: '2026-04-15T16:50:00.000Z',
        endedAt: '2026-04-15T18:00:00.000Z',
        activityClass: 'away',
        tagKey: 'coding',
        difficultyRank: 5,
        sourceRuleType: 'event',
        sourceRuleName: 'Deep Work',
      },
    ];

    const summarized = summarizeFocusSession(
      {
        ...session,
        endedAt: '2026-04-15T18:00:00.000Z',
      },
      activities,
      '2026-04-15T16:50:00.000Z',
    );

    expect(summarized.leftEarly).toBe(true);
    expect(summarized.productiveMinutes).toBe(50);
    expect(summarized.awayMinutes).toBe(70);
  });
});

describe('analytics snapshot derivations', () => {
  it('builds consumption breakdowns, a timeline, and a domain tree from activity history', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T12:00:00.000Z'));

    const focusHistory: FocusSessionRecord[] = [
      {
        id: 'focus-analytics',
        calendarEventId: 'evt-1',
        eventTitle: 'Leetcode block',
        scheduledStart: '2026-04-20T16:00:00.000Z',
        scheduledEnd: '2026-04-20T17:00:00.000Z',
        startedAt: '2026-04-20T16:00:00.000Z',
        endedAt: '2026-04-20T17:00:00.000Z',
        sourceRuleType: 'event',
        sourceRuleName: 'Leetcode block',
        tagKey: 'learning',
        difficultyRank: 5,
        productiveMinutes: 30,
        supportiveMinutes: 10,
        distractedMinutes: 20,
        awayMinutes: 0,
        breakMinutes: 0,
        totalTrackedMinutes: 60,
        leftEarly: false,
      },
    ];

    const activityHistory: ActivitySessionRecord[] = [
      {
        id: 'activity-1',
        focusSessionId: 'focus-analytics',
        calendarEventId: 'evt-1',
        eventTitle: 'Leetcode block',
        domain: 'leetcode.com',
        startedAt: '2026-04-20T16:00:00.000Z',
        endedAt: '2026-04-20T16:30:00.000Z',
        activityClass: 'aligned',
        tagKey: 'learning',
        difficultyRank: 5,
        sourceRuleType: 'event',
        sourceRuleName: 'Leetcode block',
      },
      {
        id: 'activity-2',
        focusSessionId: 'focus-analytics',
        calendarEventId: 'evt-1',
        eventTitle: 'Leetcode block',
        domain: 'docs.leetcode.com',
        startedAt: '2026-04-20T16:30:00.000Z',
        endedAt: '2026-04-20T16:40:00.000Z',
        activityClass: 'supportive',
        tagKey: 'learning',
        difficultyRank: 5,
        sourceRuleType: 'event',
        sourceRuleName: 'Leetcode block',
      },
      {
        id: 'activity-3',
        focusSessionId: 'focus-analytics',
        calendarEventId: 'evt-1',
        eventTitle: 'Leetcode block',
        domain: 'youtube.com',
        startedAt: '2026-04-20T16:40:00.000Z',
        endedAt: '2026-04-20T17:00:00.000Z',
        activityClass: 'distracted',
        tagKey: 'learning',
        difficultyRank: 5,
        sourceRuleType: 'event',
        sourceRuleName: 'Leetcode block',
      },
    ];

    const snapshot = buildAnalyticsSnapshot({
      taskTags: DEFAULT_TASK_TAGS,
      focusHistory,
      activityHistory,
      currentSession: null,
      currentActivityClass: null,
      lastCalculatedAt: '2026-04-20T17:01:00.000Z',
      lastSyncedAt: null,
    });

    expect(snapshot.domainBreakdown7d[0]).toMatchObject({
      domain: 'leetcode.com',
      totalMinutes: 30,
      primaryActivityClass: 'aligned',
    });
    expect(snapshot.domainBreakdown7d[1]).toMatchObject({
      domain: 'youtube.com',
      totalMinutes: 20,
      primaryActivityClass: 'distracted',
    });
    expect(snapshot.consumptionTimeline7d).toHaveLength(7);
    expect(
      snapshot.consumptionTimeline7d.some((point) => point.productiveMinutes === 30 && point.distractedMinutes === 20),
    ).toBe(true);
    expect(snapshot.consumptionTree7d[0]?.label).toBe('leetcode.com');
    expect(snapshot.consumptionTree7d[0]?.children[0]?.label).toBe('docs');
  });
});
