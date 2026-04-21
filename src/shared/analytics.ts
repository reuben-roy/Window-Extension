import { DEFAULT_ANALYTICS_SNAPSHOT } from './constants';
import type {
  ActivityClass,
  ActivitySessionRecord,
  ActiveActivitySessionState,
  AnalyticsRange,
  AnalyticsSnapshot,
  CalendarState,
  DifficultyBreakdownItem,
  DifficultyRank,
  FocusSessionRecord,
  LiveAnalyticsSession,
  TagBreakdownItem,
  TaskTag,
} from './types';
import { findTaskTag, normalizeDifficultyRank } from './tags';

export const AWAY_THRESHOLD_SECONDS = 5 * 60;
export const HEARTBEAT_INTERVAL_MS = 60 * 1000;
export const LEFT_EARLY_THRESHOLD_MS = 10 * 60 * 1000;
export const LOCAL_ANALYTICS_RETENTION_DAYS = 7;

const DIFFICULTY_ORDER: DifficultyRank[] = [1, 2, 3, 5, 8];

export function createEmptyFocusSession(
  id: string,
  calendarState: CalendarState,
  startedAt: string,
): FocusSessionRecord | null {
  if (!calendarState.currentEvent) return null;

  return {
    id,
    calendarEventId: calendarState.currentEvent.id,
    eventTitle: calendarState.currentEvent.title,
    scheduledStart: calendarState.currentEvent.start,
    scheduledEnd: calendarState.currentEvent.end,
    startedAt,
    endedAt: startedAt,
    sourceRuleType: calendarState.activeRuleSource,
    sourceRuleName: calendarState.activeRuleName,
    tagKey: calendarState.primaryTagKey,
    difficultyRank: calendarState.difficultyRank,
    productiveMinutes: 0,
    supportiveMinutes: 0,
    distractedMinutes: 0,
    awayMinutes: 0,
    breakMinutes: 0,
    totalTrackedMinutes: 0,
    leftEarly: false,
  };
}

export function deriveDifficultyRank(input: {
  baselineDifficulty: DifficultyRank | null;
  scheduledStart: string;
  scheduledEnd: string;
  priorSessions: FocusSessionRecord[];
  override: DifficultyRank | null;
}): DifficultyRank | null {
  if (input.override !== null) {
    return input.override;
  }

  const baseline = input.baselineDifficulty ?? 3;
  let offset: -1 | 0 | 1 = 0;
  const durationMinutes = getDurationMinutes(input.scheduledStart, input.scheduledEnd);

  if (durationMinutes >= 90) {
    offset = 1;
  } else if (durationMinutes < 30) {
    offset = -1;
  }

  const priorForSameTag = input.priorSessions.filter(
    (session) => session.difficultyRank !== null,
  );
  if (priorForSameTag.length > 0) {
    const distractionRate =
      priorForSameTag.reduce((sum, session) => {
        if (session.totalTrackedMinutes <= 0) return sum;
        return sum + session.distractedMinutes / session.totalTrackedMinutes;
      }, 0) / priorForSameTag.length;

    if (distractionRate >= 0.35 || priorForSameTag.some((session) => session.leftEarly)) {
      offset = 1;
    }
  }

  return shiftDifficulty(baseline, offset);
}

export function classifyActivityDomain(input: {
  domain: string | null;
  calendarState: CalendarState;
  tag: TaskTag | null;
  snoozed: boolean;
  idle: boolean;
}): ActivityClass {
  if (input.snoozed) return 'break';
  if (input.idle || !input.domain) return 'away';

  const domain = input.domain.toLowerCase();
  if (input.calendarState.allowedDomains.includes(domain)) {
    return 'aligned';
  }

  if (input.tag?.alignedDomains.includes(domain)) {
    return 'aligned';
  }

  if (input.tag?.supportiveDomains.includes(domain)) {
    return 'supportive';
  }

  return 'distracted';
}

export function upsertActivitySession(
  current: ActiveActivitySessionState | null,
  next: Omit<ActivitySessionRecord, 'id' | 'startedAt' | 'endedAt'> & {
    id: string;
    at: string;
  },
): {
  current: ActiveActivitySessionState;
  finalized: ActivitySessionRecord | null;
} {
  if (
    current &&
    current.focusSessionId === next.focusSessionId &&
    current.activityClass === next.activityClass &&
    current.domain === next.domain
  ) {
    return {
      current: {
        ...current,
        endedAt: next.at,
      },
      finalized: null,
    };
  }

  const nextCurrent: ActiveActivitySessionState = {
    ...next,
    startedAt: next.at,
    endedAt: next.at,
  };

  return {
    current: nextCurrent,
    finalized: current ? { ...current, endedAt: next.at } : null,
  };
}

export function finalizeActivitySession(
  current: ActiveActivitySessionState | null,
  endedAt: string,
): ActivitySessionRecord | null {
  if (!current) return null;
  return {
    ...current,
    endedAt,
  };
}

export function summarizeFocusSession(
  session: FocusSessionRecord,
  activities: ActivitySessionRecord[],
  lastProductiveAt: string | null,
): FocusSessionRecord {
  const minutesByClass: Record<ActivityClass, number> = {
    aligned: 0,
    supportive: 0,
    distracted: 0,
    away: 0,
    break: 0,
  };

  for (const activity of activities) {
    if (activity.focusSessionId !== session.id) continue;
    minutesByClass[activity.activityClass] += getDurationMinutes(activity.startedAt, activity.endedAt);
  }

  const totalTrackedMinutes = Object.values(minutesByClass).reduce((sum, value) => sum + value, 0);
  const scheduledEndMs = new Date(session.scheduledEnd).getTime();
  const lastProductiveMs = lastProductiveAt ? new Date(lastProductiveAt).getTime() : 0;
  const leftEarly =
    lastProductiveMs > 0 && scheduledEndMs - lastProductiveMs >= LEFT_EARLY_THRESHOLD_MS;

  return {
    ...session,
    productiveMinutes: minutesByClass.aligned,
    supportiveMinutes: minutesByClass.supportive,
    distractedMinutes: minutesByClass.distracted,
    awayMinutes: minutesByClass.away,
    breakMinutes: minutesByClass.break,
    totalTrackedMinutes,
    leftEarly,
  };
}

export function trimFocusSessionsHistory(
  sessions: FocusSessionRecord[],
  now: Date = new Date(),
): FocusSessionRecord[] {
  const cutoff = now.getTime() - LOCAL_ANALYTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return sessions.filter((session) => new Date(session.endedAt).getTime() >= cutoff);
}

export function trimActivityHistory(
  sessions: ActivitySessionRecord[],
  now: Date = new Date(),
): ActivitySessionRecord[] {
  const cutoff = now.getTime() - LOCAL_ANALYTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return sessions.filter((session) => new Date(session.endedAt).getTime() >= cutoff);
}

export function buildAnalyticsSnapshot(input: {
  taskTags: TaskTag[];
  focusHistory: FocusSessionRecord[];
  currentSession: FocusSessionRecord | null;
  currentActivityClass: ActivityClass | null;
  lastCalculatedAt?: string | null;
  lastSyncedAt?: string | null;
}): AnalyticsSnapshot {
  const summary7d = summarizeRange('7d', input.focusHistory);
  const summary30d = summarizeRange('30d', input.focusHistory);
  const tagBreakdown7d = buildTagBreakdown(input.focusHistory, input.taskTags, '7d');
  const difficultyBreakdown7d = buildDifficultyBreakdown(input.focusHistory, '7d');
  const currentSession = input.currentSession
    ? toLiveAnalyticsSession(input.currentSession, input.currentActivityClass, input.taskTags)
    : null;

  return {
    ...DEFAULT_ANALYTICS_SNAPSHOT,
    currentSession,
    summary7d,
    summary30d,
    tagBreakdown7d,
    difficultyBreakdown7d,
    recentSessions: [...input.focusHistory]
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
    lastCalculatedAt: input.lastCalculatedAt ?? new Date().toISOString(),
    lastSyncedAt: input.lastSyncedAt ?? null,
  };
}

export function mergeAnalyticsSnapshot(
  local: AnalyticsSnapshot,
  remote: Partial<AnalyticsSnapshot>,
): AnalyticsSnapshot {
  return {
    ...local,
    ...remote,
    currentSession: local.currentSession,
    lastCalculatedAt: local.lastCalculatedAt,
    lastSyncedAt: remote.lastSyncedAt ?? local.lastSyncedAt,
  };
}

export function getDurationMinutes(startedAt: string, endedAt: string): number {
  return Math.max(
    0,
    Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60_000),
  );
}

function summarizeRange(range: AnalyticsRange, sessions: FocusSessionRecord[]) {
  const filtered = filterSessionsForRange(range, sessions);

  return {
    range,
    productiveMinutes: filtered.reduce((sum, session) => sum + session.productiveMinutes, 0),
    supportiveMinutes: filtered.reduce((sum, session) => sum + session.supportiveMinutes, 0),
    distractedMinutes: filtered.reduce((sum, session) => sum + session.distractedMinutes, 0),
    awayMinutes: filtered.reduce((sum, session) => sum + session.awayMinutes, 0),
    breakMinutes: filtered.reduce((sum, session) => sum + session.breakMinutes, 0),
    totalFocusSessions: filtered.length,
    leftEarlyCount: filtered.filter((session) => session.leftEarly).length,
  };
}

function buildTagBreakdown(
  sessions: FocusSessionRecord[],
  taskTags: TaskTag[],
  range: AnalyticsRange,
): TagBreakdownItem[] {
  const filtered = filterSessionsForRange(range, sessions);
  const map = new Map<string, TagBreakdownItem>();

  for (const session of filtered) {
    if (!session.tagKey) continue;
    const tag = findTaskTag(taskTags, session.tagKey);
    const existing = map.get(session.tagKey) ?? {
      tagKey: session.tagKey,
      label: tag?.label ?? humanizeFallback(session.tagKey),
      color: tag?.color ?? '#64748b',
      productiveMinutes: 0,
      supportiveMinutes: 0,
      distractedMinutes: 0,
      awayMinutes: 0,
      breakMinutes: 0,
      sessions: 0,
    };

    existing.productiveMinutes += session.productiveMinutes;
    existing.supportiveMinutes += session.supportiveMinutes;
    existing.distractedMinutes += session.distractedMinutes;
    existing.awayMinutes += session.awayMinutes;
    existing.breakMinutes += session.breakMinutes;
    existing.sessions += 1;
    map.set(session.tagKey, existing);
  }

  return [...map.values()].sort((a, b) => b.productiveMinutes - a.productiveMinutes);
}

function buildDifficultyBreakdown(
  sessions: FocusSessionRecord[],
  range: AnalyticsRange,
): DifficultyBreakdownItem[] {
  const filtered = filterSessionsForRange(range, sessions);
  const map = new Map<DifficultyRank, DifficultyBreakdownItem>();

  for (const session of filtered) {
    const rank = normalizeDifficultyRank(session.difficultyRank ?? 3);
    const existing = map.get(rank) ?? {
      difficultyRank: rank,
      focusScore: 0,
      productiveMinutes: 0,
      distractedMinutes: 0,
      awayMinutes: 0,
      sessions: 0,
    };

    existing.productiveMinutes += session.productiveMinutes;
    existing.distractedMinutes += session.distractedMinutes;
    existing.awayMinutes += session.awayMinutes;
    existing.sessions += 1;
    const denominator = existing.productiveMinutes + existing.distractedMinutes + existing.awayMinutes;
    existing.focusScore = denominator > 0
      ? Math.round((existing.productiveMinutes / denominator) * 100)
      : 0;
    map.set(rank, existing);
  }

  return DIFFICULTY_ORDER.map((rank) => map.get(rank)).filter(Boolean) as DifficultyBreakdownItem[];
}

function toLiveAnalyticsSession(
  session: FocusSessionRecord,
  currentActivityClass: ActivityClass | null,
  taskTags: TaskTag[],
): LiveAnalyticsSession {
  const tag = findTaskTag(taskTags, session.tagKey);
  return {
    focusSessionId: session.id,
    eventTitle: session.eventTitle,
    tagKey: session.tagKey,
    tagLabel: tag?.label ?? null,
    difficultyRank: session.difficultyRank,
    sourceRuleType: session.sourceRuleType,
    sourceRuleName: session.sourceRuleName,
    currentActivityClass,
    startedAt: session.startedAt,
    scheduledEnd: session.scheduledEnd,
    productiveMinutes: session.productiveMinutes,
    supportiveMinutes: session.supportiveMinutes,
    distractedMinutes: session.distractedMinutes,
    awayMinutes: session.awayMinutes,
    breakMinutes: session.breakMinutes,
  };
}

function filterSessionsForRange(range: AnalyticsRange, sessions: FocusSessionRecord[]) {
  const days = range === '30d' ? 30 : 7;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return sessions.filter((session) => new Date(session.startedAt).getTime() >= cutoff);
}

function shiftDifficulty(current: DifficultyRank, offset: -1 | 0 | 1): DifficultyRank {
  const index = DIFFICULTY_ORDER.indexOf(current);
  const nextIndex = Math.min(
    DIFFICULTY_ORDER.length - 1,
    Math.max(0, index + offset),
  );
  return DIFFICULTY_ORDER[nextIndex];
}

function humanizeFallback(key: string): string {
  return key
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
