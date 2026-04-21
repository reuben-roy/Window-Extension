import { DEFAULT_ANALYTICS_SNAPSHOT } from './constants';
import type {
  ActivityClass,
  LocalActivityRecord,
  ActivitySessionRecord,
  ActiveActivitySessionState,
  ActiveLocalActivityState,
  AnalyticsRange,
  AnalyticsSnapshot,
  CalendarState,
  ConsumptionDomainItem,
  ConsumptionTimelinePoint,
  ConsumptionTreeNode,
  DifficultyBreakdownItem,
  DifficultyRank,
  FocusSessionRecord,
  LiveAnalyticsSession,
  Task,
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
    secondaryTagKeys: calendarState.secondaryTagKeys,
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
  carryoverCount?: number;
  recentDistinctDomains?: number;
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

  if ((input.carryoverCount ?? 0) > 0 || (input.recentDistinctDomains ?? 0) >= 4) {
    offset = 1;
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

export function upsertLocalActivityRecord(
  current: ActiveLocalActivityState | null,
  next: Omit<LocalActivityRecord, 'id' | 'startedAt' | 'endedAt'> & {
    id: string;
    at: string;
  },
): {
  current: ActiveLocalActivityState;
  finalized: LocalActivityRecord | null;
} {
  if (
    current &&
    current.focusSessionId === next.focusSessionId &&
    current.activityClass === next.activityClass &&
    current.domain === next.domain &&
    current.tabTitle === next.tabTitle
  ) {
    return {
      current: {
        ...current,
        endedAt: next.at,
      },
      finalized: null,
    };
  }

  const nextCurrent: ActiveLocalActivityState = {
    ...next,
    startedAt: next.at,
    endedAt: next.at,
  };

  return {
    current: nextCurrent,
    finalized: current ? { ...current, endedAt: next.at } : null,
  };
}

export function finalizeLocalActivityRecord(
  current: ActiveLocalActivityState | null,
  endedAt: string,
): LocalActivityRecord | null {
  if (!current) return null;
  return {
    ...current,
    endedAt,
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

export function trimLocalActivityHistory(
  sessions: LocalActivityRecord[],
  now: Date = new Date(),
): LocalActivityRecord[] {
  const cutoff = now.getTime() - LOCAL_ANALYTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return sessions.filter((session) => new Date(session.endedAt).getTime() >= cutoff);
}

export function getCarryoverCountForEvent(tasks: Task[], event: { id: string; title: string }): number {
  return tasks.filter(
    (task) =>
      task.status === 'carryover' &&
      (task.calendarEventId === event.id || normalizeEventTitle(task.eventTitle) === normalizeEventTitle(event.title)),
  ).length;
}

export function getRecentDistinctDomainsForTag(
  activities: ActivitySessionRecord[],
  tagKey: string | null,
): number {
  if (!tagKey) return 0;
  return new Set(
    activities
      .filter((activity) => activity.tagKey === tagKey && activity.domain)
      .map((activity) => normalizeAnalyticsDomain(activity.domain!)),
  ).size;
}

export function buildAnalyticsSnapshot(input: {
  taskTags: TaskTag[];
  focusHistory: FocusSessionRecord[];
  activityHistory: ActivitySessionRecord[];
  currentSession: FocusSessionRecord | null;
  currentActivityClass: ActivityClass | null;
  lastCalculatedAt?: string | null;
  lastSyncedAt?: string | null;
}): AnalyticsSnapshot {
  const summary7d = summarizeRange('7d', input.focusHistory);
  const summary30d = summarizeRange('30d', input.focusHistory);
  const tagBreakdown7d = buildTagBreakdown(input.focusHistory, input.taskTags, '7d');
  const difficultyBreakdown7d = buildDifficultyBreakdown(input.focusHistory, '7d');
  const domainBreakdown7d = buildDomainBreakdown(input.activityHistory, '7d');
  const consumptionTimeline7d = buildConsumptionTimeline(input.activityHistory, 7);
  const consumptionTree7d = buildConsumptionTree(input.activityHistory, '7d');
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
    domainBreakdown7d,
    consumptionTimeline7d,
    consumptionTree7d,
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

function buildDomainBreakdown(
  activities: ActivitySessionRecord[],
  range: AnalyticsRange,
): ConsumptionDomainItem[] {
  const filtered = filterActivitiesForRange(range, activities).filter((activity) => activity.domain);
  const map = new Map<string, ConsumptionDomainItem>();

  for (const activity of filtered) {
    const totalMinutes = getDurationMinutes(activity.startedAt, activity.endedAt);
    if (totalMinutes <= 0) continue;

    const domain = normalizeActivityDomainLabel(activity);
    const existing = map.get(domain) ?? {
      domain,
      label: domain,
      productiveMinutes: 0,
      supportiveMinutes: 0,
      distractedMinutes: 0,
      awayMinutes: 0,
      breakMinutes: 0,
      totalMinutes: 0,
      visits: 0,
      primaryActivityClass: activity.activityClass,
    };

    applyActivityMinutes(existing, activity.activityClass, totalMinutes);
    existing.totalMinutes += totalMinutes;
    existing.visits += 1;
    existing.primaryActivityClass = dominantActivityClass(existing);
    map.set(domain, existing);
  }

  return [...map.values()].sort((a, b) => b.totalMinutes - a.totalMinutes);
}

function buildConsumptionTimeline(
  activities: ActivitySessionRecord[],
  days: number,
): ConsumptionTimelinePoint[] {
  const points: ConsumptionTimelinePoint[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let index = days - 1; index >= 0; index -= 1) {
    const bucket = new Date(today);
    bucket.setDate(today.getDate() - index);
    points.push({
      date: bucket.toISOString(),
      label: bucket.toLocaleDateString([], { weekday: 'short' }),
      productiveMinutes: 0,
      supportiveMinutes: 0,
      distractedMinutes: 0,
      awayMinutes: 0,
      breakMinutes: 0,
      totalMinutes: 0,
    });
  }

  const pointByDate = new Map(points.map((point) => [point.date.slice(0, 10), point]));

  for (const activity of activities) {
    const key = new Date(activity.startedAt).toISOString().slice(0, 10);
    const point = pointByDate.get(key);
    if (!point) continue;
    const totalMinutes = getDurationMinutes(activity.startedAt, activity.endedAt);
    if (totalMinutes <= 0) continue;
    applyActivityMinutes(point, activity.activityClass, totalMinutes);
    point.totalMinutes += totalMinutes;
  }

  return points;
}

function buildConsumptionTree(
  activities: ActivitySessionRecord[],
  range: AnalyticsRange,
): ConsumptionTreeNode[] {
  const filtered = filterActivitiesForRange(range, activities).filter((activity) => activity.domain);
  const root: ConsumptionTreeNode[] = [];

  for (const activity of filtered) {
    const totalMinutes = getDurationMinutes(activity.startedAt, activity.endedAt);
    if (totalMinutes <= 0) continue;

    insertConsumptionPath(root, buildConsumptionPath(activity), activity.activityClass, totalMinutes);
  }

  return sortConsumptionNodes(root);
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

function filterActivitiesForRange(
  range: AnalyticsRange,
  activities: ActivitySessionRecord[],
): ActivitySessionRecord[] {
  const now = Date.now();
  const days = range === '7d' ? 7 : 30;
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return activities.filter((activity) => new Date(activity.endedAt).getTime() >= cutoff);
}

function normalizeActivityDomainLabel(activity: ActivitySessionRecord): string {
  if (activity.domain) {
    return normalizeAnalyticsDomain(activity.domain);
  }

  if (activity.activityClass === 'away') {
    return 'Away from keyboard';
  }

  if (activity.activityClass === 'break') {
    return 'Break time';
  }

  return 'Unknown page';
}

function buildConsumptionPath(activity: ActivitySessionRecord): string[] {
  if (!activity.domain) {
    return [normalizeActivityDomainLabel(activity)];
  }

  const normalizedDomain = normalizeAnalyticsDomain(activity.domain);
  const parts = normalizedDomain.split('.').filter(Boolean);
  if (parts.length <= 2) {
    return [normalizedDomain];
  }

  const root = parts.slice(-2).join('.');
  const subdomains = parts.slice(0, -2).reverse();
  return [root, ...subdomains];
}

function applyActivityMinutes(
  target: {
    productiveMinutes: number;
    supportiveMinutes: number;
    distractedMinutes: number;
    awayMinutes: number;
    breakMinutes: number;
  },
  activityClass: ActivityClass,
  minutes: number,
): void {
  if (activityClass === 'aligned') {
    target.productiveMinutes += minutes;
    return;
  }
  if (activityClass === 'supportive') {
    target.supportiveMinutes += minutes;
    return;
  }
  if (activityClass === 'distracted') {
    target.distractedMinutes += minutes;
    return;
  }
  if (activityClass === 'away') {
    target.awayMinutes += minutes;
    return;
  }
  target.breakMinutes += minutes;
}

function dominantActivityClass(target: {
  productiveMinutes: number;
  supportiveMinutes: number;
  distractedMinutes: number;
  awayMinutes: number;
  breakMinutes: number;
}): ActivityClass {
  const entries: Array<[ActivityClass, number]> = [
    ['aligned', target.productiveMinutes],
    ['supportive', target.supportiveMinutes],
    ['distracted', target.distractedMinutes],
    ['away', target.awayMinutes],
    ['break', target.breakMinutes],
  ];

  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

function sortConsumptionNodes(nodes: ConsumptionTreeNode[]): ConsumptionTreeNode[] {
  return [...nodes]
    .sort((a, b) => b.totalMinutes - a.totalMinutes)
    .map((node) => ({
      ...node,
      children: sortConsumptionNodes(node.children),
    }));
}

function insertConsumptionPath(
  nodes: ConsumptionTreeNode[],
  path: string[],
  activityClass: ActivityClass,
  minutes: number,
  depth = 0,
  parentId = '',
): void {
  const [segment, ...rest] = path;
  if (!segment) return;

  const id = parentId ? `${parentId}/${segment}` : segment;
  let node = nodes.find((candidate) => candidate.label === segment);
  if (!node) {
    node = {
      id,
      label: segment,
      depth,
      productiveMinutes: 0,
      supportiveMinutes: 0,
      distractedMinutes: 0,
      awayMinutes: 0,
      breakMinutes: 0,
      totalMinutes: 0,
      children: [],
    };
    nodes.push(node);
  }

  applyActivityMinutes(node, activityClass, minutes);
  node.totalMinutes += minutes;

  if (rest.length > 0) {
    insertConsumptionPath(node.children, rest, activityClass, minutes, depth + 1, id);
  }
}

function normalizeAnalyticsDomain(domain: string): string {
  return domain.replace(/^www\./, '').toLowerCase();
}

function toLiveAnalyticsSession(
  session: FocusSessionRecord,
  currentActivityClass: ActivityClass | null,
  taskTags: TaskTag[],
): LiveAnalyticsSession {
  const tag = findTaskTag(taskTags, session.tagKey);
  const secondaryTagLabels = session.secondaryTagKeys
    .map((key) => findTaskTag(taskTags, key)?.label ?? null)
    .filter((value): value is string => Boolean(value));
  return {
    focusSessionId: session.id,
    eventTitle: session.eventTitle,
    tagKey: session.tagKey,
    tagLabel: tag?.label ?? null,
    secondaryTagKeys: session.secondaryTagKeys,
    secondaryTagLabels,
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

function normalizeEventTitle(value: string): string {
  return value.trim().toLowerCase();
}
