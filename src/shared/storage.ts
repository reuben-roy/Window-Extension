import type {
  ActiveActivitySessionState,
  ActiveFocusSessionState,
  ActiveLocalActivityState,
  ActivityClass,
  AccountConflict,
  AccountSyncState,
  AccountUser,
  ActiveRuleSource,
  ActivitySessionRecord,
  AllTimeStats,
  AnalyticsSnapshot,
  AssistantOptions,
  BackendSession,
  BackendSyncState,
  BlockedTabState,
  BreakVisitEvent,
  CalendarEvent,
  CalendarState,
  ConsumptionDomainItem,
  ConsumptionTimelinePoint,
  ConsumptionTreeNode,
  DailyConsumptionRollup,
  DailyConsumptionRollupStore,
  DownloadAllowance,
  DifficultyBreakdownItem,
  DifficultyRank,
  ExtendedTaskAssignment,
  ExtendedTaskAssignmentItem,
  ExtendedTaskSet,
  ExtendedTaskSetItem,
  EventPatternStat,
  EventLaunchTarget,
  EventRule,
  EventBindings,
  FocusSessionRecord,
  IdeaRecord,
  KeywordRule,
  LaunchExecutionState,
  LearningSettings,
  LearningState,
  LearningSubject,
  LearningSuggestion,
  QuizAnswerChoice,
  QuizArtifact,
  QuizPackSummary,
  QuizPrompt,
  ReviewQueueItem,
  LocalActivityRecord,
  LiveAnalyticsSession,
  OpenClawState,
  PointsHistory,
  Profiles,
  Settings,
  UserLearningTopic,
  SnoozeState,
  StorageData,
  TaskTag,
  TemporaryUnlockState,
  Task,
  UnlockSpendState,
  WeeklyStats,
} from './types';
import {
  DEFAULT_ACCOUNT_SYNC_STATE,
  DEFAULT_ANALYTICS_SNAPSHOT,
  DEFAULT_ALL_TIME_STATS,
  DEFAULT_ASSISTANT_OPTIONS,
  DEFAULT_BACKEND_SYNC_STATE,
  DEFAULT_EXTENDED_TASK_ASSIGNMENTS,
  DEFAULT_EXTENDED_TASK_SETS,
  DEFAULT_GLOBAL_ALLOWLIST,
  DEFAULT_LEARNING_STATE,
  DEFAULT_OPENCLAW_STATE,
  DEFAULT_SETTINGS,
  DEFAULT_SNOOZE_STATE,
  DEFAULT_TASK_TAGS,
} from './constants';
import { ensureDefaultTaskTags, normalizeDifficultyRank } from './tags';

// ─── Generic helpers ─────────────────────────────────────────────────────────

function get<T>(key: string, defaultValue: T): Promise<T> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(key, (result) => {
      resolve(result[key] !== undefined ? (result[key] as T) : defaultValue);
    });
  });
}

function set<T>(key: string, value: T): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set({ [key]: value }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

function remove(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.remove(key, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

function getLocal<T>(key: string, defaultValue: T): Promise<T> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      resolve(result[key] !== undefined ? (result[key] as T) : defaultValue);
    });
  });
}

function removeLocal(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(key, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

function setLocal<T>(key: string, value: T): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function normalizeDifficultyRankOrNull(value: unknown): DifficultyRank | null {
  return typeof value === 'number' ? normalizeDifficultyRank(value) : null;
}

function normalizeActiveRuleSource(value: unknown): ActiveRuleSource {
  return value === 'event' || value === 'keyword' || value === 'none' ? value : 'none';
}

function normalizeActivityClass(value: unknown): ActivityClass {
  return value === 'aligned' ||
    value === 'supportive' ||
    value === 'distracted' ||
    value === 'away' ||
    value === 'break'
    ? value
    : 'away';
}

function normalizeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeCalendarEvent(event: Partial<CalendarEvent> | null | undefined): CalendarEvent | null {
  if (!event || typeof event !== 'object') return null;

  return {
    id: typeof event.id === 'string' ? event.id : '',
    title: typeof event.title === 'string' ? event.title : '',
    start: typeof event.start === 'string' ? event.start : '',
    end: typeof event.end === 'string' ? event.end : '',
    isAllDay: Boolean(event.isAllDay),
    description: normalizeNullableString(event.description),
    attendees: normalizeStringArray(event.attendees),
    googleColorId: typeof event.googleColorId === 'string' ? event.googleColorId : undefined,
    backgroundColor: typeof event.backgroundColor === 'string' ? event.backgroundColor : null,
    foregroundColor: typeof event.foregroundColor === 'string' ? event.foregroundColor : null,
    colorSource:
      event.colorSource === 'google-event' || event.colorSource === 'derived' || event.colorSource === 'default'
        ? event.colorSource
        : undefined,
    recurringEventId: typeof event.recurringEventId === 'string' ? event.recurringEventId : undefined,
    recurrenceHint: typeof event.recurrenceHint === 'string' ? event.recurrenceHint : null,
  };
}

function normalizeCalendarEvents(events: unknown): CalendarEvent[] {
  if (!Array.isArray(events)) return [];
  return events
    .map((event) => normalizeCalendarEvent(event as Partial<CalendarEvent>))
    .filter((event): event is CalendarEvent => event !== null);
}

function normalizeEventRulesStored(rules: EventRule[]): EventRule[] {
  return (Array.isArray(rules) ? rules : [])
    .filter((rule) => Boolean(rule?.eventTitle))
    .map((rule) => ({
      eventTitle: rule.eventTitle,
      domains: normalizeStringArray(rule.domains),
      tagKey: normalizeNullableString(rule.tagKey),
      secondaryTagKeys: normalizeStringArray(rule.secondaryTagKeys),
      difficultyOverride: normalizeDifficultyRankOrNull(rule.difficultyOverride),
    }));
}

function normalizeKeywordRulesStored(rules: KeywordRule[]): KeywordRule[] {
  return (Array.isArray(rules) ? rules : [])
    .filter((rule) => Boolean(rule?.keyword))
    .map((rule) => ({
      keyword: rule.keyword,
      domains: normalizeStringArray(rule.domains),
      createdAt: typeof rule.createdAt === 'string' ? rule.createdAt : new Date(0).toISOString(),
      tagKey: normalizeNullableString(rule.tagKey),
    }));
}

function normalizeExtendedTaskSetItem(
  item: Partial<ExtendedTaskSetItem> | null | undefined,
): ExtendedTaskSetItem | null {
  if (!item || typeof item !== 'object') return null;

  const id = typeof item.id === 'string' && item.id.trim().length > 0 ? item.id : '';
  const label = typeof item.label === 'string' ? item.label.trim() : '';
  const url = typeof item.url === 'string' ? item.url.trim() : '';

  if (!id || !label || !url) return null;

  return {
    id,
    label,
    url,
  };
}

function normalizeExtendedTaskSetStored(
  taskSet: Partial<ExtendedTaskSet> | null | undefined,
): ExtendedTaskSet | null {
  if (!taskSet || typeof taskSet !== 'object') return null;

  const id = typeof taskSet.id === 'string' && taskSet.id.trim().length > 0 ? taskSet.id : '';
  const title = typeof taskSet.title === 'string' ? taskSet.title.trim() : '';
  if (!id || !title) return null;

  return {
    id,
    title,
    items: Array.isArray(taskSet.items)
      ? taskSet.items
          .map((item) => normalizeExtendedTaskSetItem(item))
          .filter((item): item is ExtendedTaskSetItem => item !== null)
      : [],
    createdAt: typeof taskSet.createdAt === 'string' ? taskSet.createdAt : new Date(0).toISOString(),
    updatedAt: typeof taskSet.updatedAt === 'string' ? taskSet.updatedAt : new Date(0).toISOString(),
    archivedAt: normalizeNullableString(taskSet.archivedAt),
  };
}

function normalizeExtendedTaskSetsStored(taskSets: unknown): ExtendedTaskSet[] {
  if (!Array.isArray(taskSets)) return [];
  return taskSets
    .map((taskSet) => normalizeExtendedTaskSetStored(taskSet as Partial<ExtendedTaskSet>))
    .filter((taskSet): taskSet is ExtendedTaskSet => taskSet !== null);
}

function normalizeExtendedTaskAssignmentItem(
  item: Partial<ExtendedTaskAssignmentItem> | null | undefined,
): ExtendedTaskAssignmentItem | null {
  if (!item || typeof item !== 'object') return null;

  const id = typeof item.id === 'string' && item.id.trim().length > 0 ? item.id : '';
  const label = typeof item.label === 'string' ? item.label.trim() : '';
  const url = typeof item.url === 'string' ? item.url.trim() : '';
  if (!id || !label || !url) return null;

  return {
    id,
    label,
    url,
    completedAt: normalizeNullableString(item.completedAt),
  };
}

function normalizeExtendedTaskAssignmentStored(
  assignment: Partial<ExtendedTaskAssignment> | null | undefined,
): ExtendedTaskAssignment | null {
  if (!assignment || typeof assignment !== 'object') return null;

  const id = typeof assignment.id === 'string' && assignment.id.trim().length > 0 ? assignment.id : '';
  const calendarEventId =
    typeof assignment.calendarEventId === 'string' && assignment.calendarEventId.trim().length > 0
      ? assignment.calendarEventId
      : '';
  if (!id || !calendarEventId) return null;

  return {
    id,
    calendarEventId,
    eventTitle: typeof assignment.eventTitle === 'string' ? assignment.eventTitle : '',
    start: typeof assignment.start === 'string' ? assignment.start : '',
    end: typeof assignment.end === 'string' ? assignment.end : '',
    setId: typeof assignment.setId === 'string' ? assignment.setId : '',
    setTitle: typeof assignment.setTitle === 'string' ? assignment.setTitle : '',
    items: Array.isArray(assignment.items)
      ? assignment.items
          .map((item) => normalizeExtendedTaskAssignmentItem(item))
          .filter((item): item is ExtendedTaskAssignmentItem => item !== null)
      : [],
    createdAt: typeof assignment.createdAt === 'string' ? assignment.createdAt : new Date(0).toISOString(),
    updatedAt: typeof assignment.updatedAt === 'string' ? assignment.updatedAt : new Date(0).toISOString(),
  };
}

function normalizeExtendedTaskAssignmentsStored(assignments: unknown): ExtendedTaskAssignment[] {
  if (!Array.isArray(assignments)) return [];
  return assignments
    .map((assignment) => normalizeExtendedTaskAssignmentStored(assignment as Partial<ExtendedTaskAssignment>))
    .filter((assignment): assignment is ExtendedTaskAssignment => assignment !== null);
}

function normalizeFocusSessionRecord(
  session: Partial<FocusSessionRecord> | null | undefined,
): FocusSessionRecord | null {
  if (!session || typeof session !== 'object') return null;

  return {
    id: typeof session.id === 'string' ? session.id : '',
    calendarEventId: typeof session.calendarEventId === 'string' ? session.calendarEventId : '',
    eventTitle: typeof session.eventTitle === 'string' ? session.eventTitle : '',
    scheduledStart: typeof session.scheduledStart === 'string' ? session.scheduledStart : '',
    scheduledEnd: typeof session.scheduledEnd === 'string' ? session.scheduledEnd : '',
    startedAt: typeof session.startedAt === 'string' ? session.startedAt : '',
    endedAt: typeof session.endedAt === 'string' ? session.endedAt : '',
    sourceRuleType: normalizeActiveRuleSource(session.sourceRuleType),
    sourceRuleName: normalizeNullableString(session.sourceRuleName),
    tagKey: normalizeNullableString(session.tagKey),
    secondaryTagKeys: normalizeStringArray(session.secondaryTagKeys),
    difficultyRank: normalizeDifficultyRankOrNull(session.difficultyRank),
    productiveMinutes: normalizeNumber(session.productiveMinutes),
    supportiveMinutes: normalizeNumber(session.supportiveMinutes),
    distractedMinutes: normalizeNumber(session.distractedMinutes),
    awayMinutes: normalizeNumber(session.awayMinutes),
    breakMinutes: normalizeNumber(session.breakMinutes),
    totalTrackedMinutes: normalizeNumber(session.totalTrackedMinutes),
    leftEarly: Boolean(session.leftEarly),
  };
}

function normalizeFocusSessionRecords(items: unknown): FocusSessionRecord[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => normalizeFocusSessionRecord(item as Partial<FocusSessionRecord>))
    .filter((item): item is FocusSessionRecord => item !== null);
}

function normalizeActivitySessionRecord(
  session: Partial<ActivitySessionRecord> | null | undefined,
): ActivitySessionRecord | null {
  if (!session || typeof session !== 'object') return null;

  return {
    id: typeof session.id === 'string' ? session.id : '',
    focusSessionId: typeof session.focusSessionId === 'string' ? session.focusSessionId : '',
    calendarEventId: typeof session.calendarEventId === 'string' ? session.calendarEventId : '',
    eventTitle: typeof session.eventTitle === 'string' ? session.eventTitle : '',
    domain: normalizeNullableString(session.domain),
    startedAt: typeof session.startedAt === 'string' ? session.startedAt : '',
    endedAt: typeof session.endedAt === 'string' ? session.endedAt : '',
    activityClass: normalizeActivityClass(session.activityClass),
    tagKey: normalizeNullableString(session.tagKey),
    secondaryTagKeys: normalizeStringArray(session.secondaryTagKeys),
    difficultyRank: normalizeDifficultyRankOrNull(session.difficultyRank),
    sourceRuleType: normalizeActiveRuleSource(session.sourceRuleType),
    sourceRuleName: normalizeNullableString(session.sourceRuleName),
  };
}

function normalizeActivitySessionRecords(items: unknown): ActivitySessionRecord[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => normalizeActivitySessionRecord(item as Partial<ActivitySessionRecord>))
    .filter((item): item is ActivitySessionRecord => item !== null);
}

function normalizeLocalActivityRecord(
  session: Partial<LocalActivityRecord> | null | undefined,
): LocalActivityRecord | null {
  if (!session || typeof session !== 'object') return null;

  return {
    id: typeof session.id === 'string' ? session.id : '',
    focusSessionId: typeof session.focusSessionId === 'string' ? session.focusSessionId : '',
    calendarEventId: typeof session.calendarEventId === 'string' ? session.calendarEventId : '',
    eventTitle: typeof session.eventTitle === 'string' ? session.eventTitle : '',
    domain: normalizeNullableString(session.domain),
    tabTitle: normalizeNullableString(session.tabTitle),
    startedAt: typeof session.startedAt === 'string' ? session.startedAt : '',
    endedAt: typeof session.endedAt === 'string' ? session.endedAt : '',
    activityClass: normalizeActivityClass(session.activityClass),
    primaryTagKey: normalizeNullableString(session.primaryTagKey),
    secondaryTagKeys: normalizeStringArray(session.secondaryTagKeys),
  };
}

function normalizeLocalActivityRecords(items: unknown): LocalActivityRecord[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => normalizeLocalActivityRecord(item as Partial<LocalActivityRecord>))
    .filter((item): item is LocalActivityRecord => item !== null);
}

function normalizeLiveAnalyticsSession(
  session: Partial<LiveAnalyticsSession> | null | undefined,
): LiveAnalyticsSession | null {
  if (!session || typeof session !== 'object') return null;

  return {
    focusSessionId: typeof session.focusSessionId === 'string' ? session.focusSessionId : '',
    eventTitle: typeof session.eventTitle === 'string' ? session.eventTitle : '',
    tagKey: normalizeNullableString(session.tagKey),
    tagLabel: normalizeNullableString(session.tagLabel),
    secondaryTagKeys: normalizeStringArray(session.secondaryTagKeys),
    secondaryTagLabels: normalizeStringArray(session.secondaryTagLabels),
    difficultyRank: normalizeDifficultyRankOrNull(session.difficultyRank),
    sourceRuleType: normalizeActiveRuleSource(session.sourceRuleType),
    sourceRuleName: normalizeNullableString(session.sourceRuleName),
    currentActivityClass:
      session.currentActivityClass == null ? null : normalizeActivityClass(session.currentActivityClass),
    startedAt: typeof session.startedAt === 'string' ? session.startedAt : '',
    scheduledEnd: typeof session.scheduledEnd === 'string' ? session.scheduledEnd : '',
    productiveMinutes: normalizeNumber(session.productiveMinutes),
    supportiveMinutes: normalizeNumber(session.supportiveMinutes),
    distractedMinutes: normalizeNumber(session.distractedMinutes),
    awayMinutes: normalizeNumber(session.awayMinutes),
    breakMinutes: normalizeNumber(session.breakMinutes),
  };
}

function normalizeActiveFocusSessionState(
  session: Partial<ActiveFocusSessionState> | null | undefined,
): ActiveFocusSessionState | null {
  if (!session || typeof session !== 'object') return null;

  const normalizedSession = normalizeFocusSessionRecord(
    'session' in session ? session.session : (session as Partial<FocusSessionRecord>),
  );
  if (!normalizedSession) return null;

  return {
    session: normalizedSession,
    lastProductiveAt: normalizeNullableString(session.lastProductiveAt),
  };
}

function normalizeAnalyticsSummary(value: unknown, range: '7d' | '30d') {
  const summary = typeof value === 'object' && value !== null ? value as Partial<AnalyticsSnapshot['summary7d']> : {};
  return {
    range,
    productiveMinutes: normalizeNumber(summary.productiveMinutes),
    supportiveMinutes: normalizeNumber(summary.supportiveMinutes),
    distractedMinutes: normalizeNumber(summary.distractedMinutes),
    awayMinutes: normalizeNumber(summary.awayMinutes),
    breakMinutes: normalizeNumber(summary.breakMinutes),
    totalFocusSessions: normalizeNumber(summary.totalFocusSessions),
    leftEarlyCount: normalizeNumber(summary.leftEarlyCount),
  };
}

function normalizeTagBreakdownItems(value: unknown): AnalyticsSnapshot['tagBreakdown7d'] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const entry = item as Partial<AnalyticsSnapshot['tagBreakdown7d'][number]>;
      return {
        tagKey: typeof entry.tagKey === 'string' ? entry.tagKey : 'untagged',
        label: typeof entry.label === 'string' ? entry.label : 'Untagged',
        color: typeof entry.color === 'string' ? entry.color : '#64748b',
        productiveMinutes: normalizeNumber(entry.productiveMinutes),
        supportiveMinutes: normalizeNumber(entry.supportiveMinutes),
        distractedMinutes: normalizeNumber(entry.distractedMinutes),
        awayMinutes: normalizeNumber(entry.awayMinutes),
        breakMinutes: normalizeNumber(entry.breakMinutes),
        sessions: normalizeNumber(entry.sessions),
      };
    });
}

function normalizeDifficultyBreakdownItems(value: unknown): DifficultyBreakdownItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const entry = item as Partial<DifficultyBreakdownItem>;
      return {
        difficultyRank: normalizeDifficultyRankOrNull(entry.difficultyRank) ?? 3,
        focusScore: normalizeNumber(entry.focusScore),
        productiveMinutes: normalizeNumber(entry.productiveMinutes),
        distractedMinutes: normalizeNumber(entry.distractedMinutes),
        awayMinutes: normalizeNumber(entry.awayMinutes),
        sessions: normalizeNumber(entry.sessions),
      };
    });
}

function normalizeConsumptionDomainItems(value: unknown): ConsumptionDomainItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const entry = item as Partial<ConsumptionDomainItem>;
      return {
        domain: typeof entry.domain === 'string' ? entry.domain : 'unknown',
        label: typeof entry.label === 'string' ? entry.label : 'Unknown',
        productiveMinutes: normalizeNumber(entry.productiveMinutes),
        supportiveMinutes: normalizeNumber(entry.supportiveMinutes),
        distractedMinutes: normalizeNumber(entry.distractedMinutes),
        awayMinutes: normalizeNumber(entry.awayMinutes),
        breakMinutes: normalizeNumber(entry.breakMinutes),
        totalMinutes: normalizeNumber(entry.totalMinutes),
        visits: normalizeNumber(entry.visits),
        primaryActivityClass: normalizeActivityClass(entry.primaryActivityClass),
      };
    });
}

function normalizeConsumptionTimelineItems(value: unknown): ConsumptionTimelinePoint[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const entry = item as Partial<ConsumptionTimelinePoint>;
      return {
        date: typeof entry.date === 'string' ? entry.date : '',
        label: typeof entry.label === 'string' ? entry.label : '',
        productiveMinutes: normalizeNumber(entry.productiveMinutes),
        supportiveMinutes: normalizeNumber(entry.supportiveMinutes),
        distractedMinutes: normalizeNumber(entry.distractedMinutes),
        awayMinutes: normalizeNumber(entry.awayMinutes),
        breakMinutes: normalizeNumber(entry.breakMinutes),
        totalMinutes: normalizeNumber(entry.totalMinutes),
      };
    });
}

function normalizeConsumptionTreeNode(node: Partial<ConsumptionTreeNode> | null | undefined): ConsumptionTreeNode | null {
  if (!node || typeof node !== 'object') return null;
  return {
    id: typeof node.id === 'string' ? node.id : '',
    label: typeof node.label === 'string' ? node.label : '',
    depth: normalizeNumber(node.depth),
    productiveMinutes: normalizeNumber(node.productiveMinutes),
    supportiveMinutes: normalizeNumber(node.supportiveMinutes),
    distractedMinutes: normalizeNumber(node.distractedMinutes),
    awayMinutes: normalizeNumber(node.awayMinutes),
    breakMinutes: normalizeNumber(node.breakMinutes),
    totalMinutes: normalizeNumber(node.totalMinutes),
    children: Array.isArray(node.children)
      ? node.children
          .map((child) => normalizeConsumptionTreeNode(child as Partial<ConsumptionTreeNode>))
          .filter((child): child is ConsumptionTreeNode => child !== null)
      : [],
  };
}

function normalizeConsumptionTree(value: unknown): ConsumptionTreeNode[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((node) => normalizeConsumptionTreeNode(node as Partial<ConsumptionTreeNode>))
    .filter((node): node is ConsumptionTreeNode => node !== null);
}

function normalizeDailyConsumptionTopDomain(
  item: Partial<DailyConsumptionRollup['topDomains'][number]> | null | undefined,
): DailyConsumptionRollup['topDomains'][number] | null {
  if (!item || typeof item !== 'object') return null;
  return {
    domain: typeof item.domain === 'string' ? item.domain : '',
    label: typeof item.label === 'string' ? item.label : '',
    productiveMinutes: normalizeNumber(item.productiveMinutes),
    supportiveMinutes: normalizeNumber(item.supportiveMinutes),
    distractedMinutes: normalizeNumber(item.distractedMinutes),
    awayMinutes: normalizeNumber(item.awayMinutes),
    breakMinutes: normalizeNumber(item.breakMinutes),
    totalMinutes: normalizeNumber(item.totalMinutes),
    visits: normalizeNumber(item.visits),
  };
}

function normalizeDailyConsumptionRollup(
  item: Partial<DailyConsumptionRollup> | null | undefined,
): DailyConsumptionRollup | null {
  if (!item || typeof item !== 'object') return null;
  const dateKey = typeof item.dateKey === 'string' ? item.dateKey : '';
  if (!dateKey) return null;
  return {
    dateKey,
    productiveMinutes: normalizeNumber(item.productiveMinutes),
    supportiveMinutes: normalizeNumber(item.supportiveMinutes),
    distractedMinutes: normalizeNumber(item.distractedMinutes),
    awayMinutes: normalizeNumber(item.awayMinutes),
    breakMinutes: normalizeNumber(item.breakMinutes),
    totalMinutes: normalizeNumber(item.totalMinutes),
    topDomains: Array.isArray(item.topDomains)
      ? item.topDomains
          .map((entry) => normalizeDailyConsumptionTopDomain(entry as Partial<DailyConsumptionRollup['topDomains'][number]>))
          .filter((entry): entry is DailyConsumptionRollup['topDomains'][number] => entry !== null)
      : [],
    otherDomainMinutes: normalizeNumber(item.otherDomainMinutes),
  };
}

function normalizeDailyConsumptionRollupStore(value: unknown): DailyConsumptionRollupStore {
  if (!value || typeof value !== 'object') return {};
  const entries = Object.entries(value as Record<string, unknown>);
  const store: DailyConsumptionRollupStore = {};
  for (const [key, raw] of entries) {
    const normalized = normalizeDailyConsumptionRollup(raw as Partial<DailyConsumptionRollup>);
    if (!normalized) continue;
    store[key] = normalized;
  }
  return store;
}

function normalizeAnalyticsSnapshotStored(snapshot: AnalyticsSnapshot): AnalyticsSnapshot {
  return {
    ...DEFAULT_ANALYTICS_SNAPSHOT,
    currentSession: normalizeLiveAnalyticsSession(snapshot?.currentSession),
    summary7d: normalizeAnalyticsSummary(snapshot?.summary7d, '7d'),
    summary30d: normalizeAnalyticsSummary(snapshot?.summary30d, '30d'),
    tagBreakdown7d: normalizeTagBreakdownItems(snapshot?.tagBreakdown7d),
    difficultyBreakdown7d: normalizeDifficultyBreakdownItems(snapshot?.difficultyBreakdown7d),
    domainBreakdown7d: normalizeConsumptionDomainItems(snapshot?.domainBreakdown7d),
    consumptionTimeline7d: normalizeConsumptionTimelineItems(snapshot?.consumptionTimeline7d),
    consumptionTimeline30d: normalizeConsumptionTimelineItems(snapshot?.consumptionTimeline30d),
    consumptionTimeline90d: normalizeConsumptionTimelineItems(snapshot?.consumptionTimeline90d),
    consumptionTimeline365d: normalizeConsumptionTimelineItems(snapshot?.consumptionTimeline365d),
    domainBreakdown30d: normalizeConsumptionDomainItems(snapshot?.domainBreakdown30d),
    domainBreakdown90d: normalizeConsumptionDomainItems(snapshot?.domainBreakdown90d),
    domainBreakdown365d: normalizeConsumptionDomainItems(snapshot?.domainBreakdown365d),
    consumptionTree7d: normalizeConsumptionTree(snapshot?.consumptionTree7d),
    recentSessions: normalizeFocusSessionRecords(snapshot?.recentSessions),
    lastCalculatedAt: normalizeNullableString(snapshot?.lastCalculatedAt),
    lastSyncedAt: normalizeNullableString(snapshot?.lastSyncedAt),
  };
}

function normalizeLearningSettingsStored(
  settings: Partial<LearningSettings> | null | undefined,
): LearningSettings {
  return {
    ...DEFAULT_SETTINGS.learningSettings,
    suggestTopicsFromActivity: normalizeBoolean(
      settings?.suggestTopicsFromActivity,
      DEFAULT_SETTINGS.learningSettings.suggestTopicsFromActivity,
    ),
    intensity:
      settings?.intensity === 'quiet' ||
      settings?.intensity === 'balanced' ||
      settings?.intensity === 'aggressive'
        ? settings.intensity
        : DEFAULT_SETTINGS.learningSettings.intensity,
    licenseMode:
      settings?.licenseMode === 'commercial_safe' ||
      settings?.licenseMode === 'expanded_oer'
        ? settings.licenseMode
        : DEFAULT_SETTINGS.learningSettings.licenseMode,
  };
}

function normalizeSettingsStored(settings: Partial<Settings> | null | undefined): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    featureFlags: {
      ...DEFAULT_SETTINGS.featureFlags,
      ...(settings?.featureFlags ?? {}),
      blocking: normalizeBoolean(
        settings?.featureFlags?.blocking,
        DEFAULT_SETTINGS.featureFlags.blocking,
      ),
      routines: normalizeBoolean(
        settings?.featureFlags?.routines,
        DEFAULT_SETTINGS.featureFlags.routines,
      ),
      learning: normalizeBoolean(
        settings?.featureFlags?.learning,
        DEFAULT_SETTINGS.featureFlags.learning,
      ),
    },
    learningSettings: normalizeLearningSettingsStored(settings?.learningSettings),
  };
}

function normalizeCalendarStateStored(state: CalendarState): CalendarState {
  return {
    ...DEFAULT_CALENDAR_STATE,
    ...state,
    currentEvent: normalizeCalendarEvent(state?.currentEvent),
    activeLaunchTarget: state?.activeLaunchTarget ?? null,
    allActiveEvents: normalizeCalendarEvents(state?.allActiveEvents),
    todaysEvents: normalizeCalendarEvents(state?.todaysEvents),
    activeProfile: normalizeNullableString(state?.activeProfile),
    activeRuleSource: normalizeActiveRuleSource(state?.activeRuleSource),
    activeRuleName: normalizeNullableString(state?.activeRuleName),
    primaryTagKey: normalizeNullableString(state?.primaryTagKey),
    primaryTagLabel: normalizeNullableString(state?.primaryTagLabel),
    secondaryTagKeys: normalizeStringArray(state?.secondaryTagKeys),
    secondaryTagLabels: normalizeStringArray(state?.secondaryTagLabels),
    difficultyRank: normalizeDifficultyRankOrNull(state?.difficultyRank),
    allowedDomains: normalizeStringArray(state?.allowedDomains),
    recentEventTitles: normalizeStringArray(state?.recentEventTitles),
    isRestricted: Boolean(state?.isRestricted),
    lastSyncedAt: normalizeNullableString(state?.lastSyncedAt),
    authError: normalizeNullableString(state?.authError),
  };
}

function normalizeAssistantOptionsStored(options: Partial<AssistantOptions> | null | undefined): AssistantOptions {
  return {
    ...DEFAULT_ASSISTANT_OPTIONS,
    ...options,
    preferredModel: {
      ...DEFAULT_ASSISTANT_OPTIONS.preferredModel,
      ...(options?.preferredModel ?? {}),
      value:
        typeof options?.preferredModel?.value === 'string' && options.preferredModel.value.trim().length > 0
          ? options.preferredModel.value
          : DEFAULT_ASSISTANT_OPTIONS.preferredModel.value,
      updatedAt: normalizeNullableString(options?.preferredModel?.updatedAt),
    },
    assistantFeatureEnabled:
      typeof options?.assistantFeatureEnabled === 'boolean'
        ? options.assistantFeatureEnabled
        : DEFAULT_ASSISTANT_OPTIONS.assistantFeatureEnabled,
    autoCreateSession: options?.autoCreateSession ?? DEFAULT_ASSISTANT_OPTIONS.autoCreateSession,
    reuseActiveSession: options?.reuseActiveSession ?? DEFAULT_ASSISTANT_OPTIONS.reuseActiveSession,
    selectedConnectorId: normalizeNullableString(options?.selectedConnectorId),
    taskNotificationMode:
      options?.taskNotificationMode === 'immediate' ||
      options?.taskNotificationMode === 'after_focus' ||
      options?.taskNotificationMode === 'inbox_only'
        ? options.taskNotificationMode
        : DEFAULT_ASSISTANT_OPTIONS.taskNotificationMode,
    notes: typeof options?.notes === 'string' ? options.notes : DEFAULT_ASSISTANT_OPTIONS.notes,
  };
}

function normalizeOpenClawStateStored(state: Partial<OpenClawState> | null | undefined): OpenClawState {
  return {
    ...DEFAULT_OPENCLAW_STATE,
    ...state,
    status: {
      ...DEFAULT_OPENCLAW_STATE.status,
      ...(state?.status ?? {}),
      connected: Boolean(state?.status?.connected),
      healthy: Boolean(state?.status?.healthy),
      transport:
        state?.status?.transport === 'ssh' ||
        state?.status?.transport === 'http' ||
        state?.status?.transport === 'unknown'
          ? state.status.transport
          : DEFAULT_OPENCLAW_STATE.status.transport,
      label: normalizeNullableString(state?.status?.label),
      message: normalizeNullableString(state?.status?.message),
      lastCheckedAt: normalizeNullableString(state?.status?.lastCheckedAt),
    },
    connectors: Array.isArray(state?.connectors) ? state.connectors : [],
    selectedConnectorId: normalizeNullableString(state?.selectedConnectorId),
    sessions: Array.isArray(state?.sessions) ? state.sessions : [],
    activeSessionId: normalizeNullableString(state?.activeSessionId),
    currentJob: state?.currentJob ?? null,
    currentTask: state?.currentTask ?? null,
    tasks: Array.isArray(state?.tasks) ? state.tasks : [],
    lastError: normalizeNullableString(state?.lastError),
  };
}

function normalizeLearningSubject(subject: Partial<LearningSubject> | null | undefined): LearningSubject | null {
  if (!subject || typeof subject !== 'object') return null;
  const key = typeof subject.key === 'string' ? subject.key.trim() : '';
  const label = typeof subject.label === 'string' ? subject.label.trim() : '';
  if (!key || !label) return null;
  return {
    key,
    label,
    description: typeof subject.description === 'string' ? subject.description : '',
    topics: Array.isArray(subject.topics)
      ? subject.topics
          .map((topic) => {
            if (!topic || typeof topic !== 'object') return null;
            const topicKey = typeof topic.key === 'string' ? topic.key.trim() : '';
            const topicLabel = typeof topic.label === 'string' ? topic.label.trim() : '';
            if (!topicKey || !topicLabel) return null;
            return {
              key: topicKey,
              label: topicLabel,
              description: typeof topic.description === 'string' ? topic.description : '',
            };
          })
          .filter((topic): topic is LearningSubject['topics'][number] => topic !== null)
      : [],
  };
}

function normalizeUserLearningTopic(
  topic: Partial<UserLearningTopic> | null | undefined,
): UserLearningTopic | null {
  if (!topic || typeof topic !== 'object') return null;
  const id = typeof topic.id === 'string' ? topic.id.trim() : '';
  const topicKey = typeof topic.topicKey === 'string' ? topic.topicKey.trim() : '';
  const label = typeof topic.label === 'string' ? topic.label.trim() : '';
  if (!id || !topicKey || !label) return null;
  return {
    id,
    topicKey,
    label,
    subjectKey: normalizeNullableString(topic.subjectKey),
    source:
      topic.source === 'catalog' || topic.source === 'custom' || topic.source === 'suggested'
        ? topic.source
        : 'catalog',
    active: normalizeBoolean(topic.active, true),
    createdAt: typeof topic.createdAt === 'string' ? topic.createdAt : new Date(0).toISOString(),
    updatedAt: typeof topic.updatedAt === 'string' ? topic.updatedAt : new Date(0).toISOString(),
  };
}

function normalizeLearningSuggestion(
  suggestion: Partial<LearningSuggestion> | null | undefined,
): LearningSuggestion | null {
  if (!suggestion || typeof suggestion !== 'object') return null;
  const id = typeof suggestion.id === 'string' ? suggestion.id.trim() : '';
  const topicKey = typeof suggestion.topicKey === 'string' ? suggestion.topicKey.trim() : '';
  const label = typeof suggestion.label === 'string' ? suggestion.label.trim() : '';
  if (!id || !topicKey || !label) return null;
  return {
    id,
    topicKey,
    label,
    subjectKey: normalizeNullableString(suggestion.subjectKey),
    reason: typeof suggestion.reason === 'string' ? suggestion.reason : '',
    source:
      suggestion.source === 'calendar' ||
      suggestion.source === 'activity' ||
      suggestion.source === 'tag' ||
      suggestion.source === 'recommendation'
        ? suggestion.source
        : 'recommendation',
  };
}

function normalizeQuizPackSummary(
  pack: Partial<QuizPackSummary> | null | undefined,
): QuizPackSummary | null {
  if (!pack || typeof pack !== 'object') return null;
  const id = typeof pack.id === 'string' ? pack.id.trim() : '';
  const topicId = typeof pack.topicId === 'string' ? pack.topicId.trim() : '';
  const topicLabel = typeof pack.topicLabel === 'string' ? pack.topicLabel.trim() : '';
  const title = typeof pack.title === 'string' ? pack.title.trim() : '';
  if (!id || !topicId || !topicLabel || !title) return null;
  return {
    id,
    topicId,
    topicLabel,
    title,
    sourceKind: pack.sourceKind === 'paper-based' ? 'paper-based' : 'textbook',
    status:
      pack.status === 'queued' ||
      pack.status === 'processing' ||
      pack.status === 'ready' ||
      pack.status === 'failed'
        ? pack.status
        : 'queued',
    canonical: normalizeBoolean(pack.canonical, true),
    chapterCount: normalizeNumber(pack.chapterCount),
    questionCount: normalizeNumber(pack.questionCount),
    versionNumber: Math.max(1, normalizeNumber(pack.versionNumber)),
    licenseMode: pack.licenseMode === 'expanded_oer' ? 'expanded_oer' : 'commercial_safe',
    generatedAt: normalizeNullableString(pack.generatedAt),
  };
}

function normalizeReviewQueueItem(
  item: Partial<ReviewQueueItem> | null | undefined,
): ReviewQueueItem | null {
  if (!item || typeof item !== 'object') return null;
  const progressId = typeof item.progressId === 'string' ? item.progressId.trim() : '';
  const questionId = typeof item.questionId === 'string' ? item.questionId.trim() : '';
  const topicId = typeof item.topicId === 'string' ? item.topicId.trim() : '';
  const topicLabel = typeof item.topicLabel === 'string' ? item.topicLabel.trim() : '';
  const chapterTitle = typeof item.chapterTitle === 'string' ? item.chapterTitle.trim() : '';
  if (!progressId || !questionId || !topicId || !topicLabel || !chapterTitle) return null;
  return {
    progressId,
    questionId,
    topicId,
    topicLabel,
    chapterTitle,
    difficulty:
      item.difficulty === 'easy' || item.difficulty === 'medium' || item.difficulty === 'hard'
        ? item.difficulty
        : 'easy',
    dueAt: typeof item.dueAt === 'string' ? item.dueAt : new Date(0).toISOString(),
    lastSeenAt: normalizeNullableString(item.lastSeenAt),
    seenCount: normalizeNumber(item.seenCount),
    correctStreak: normalizeNumber(item.correctStreak),
  };
}

function normalizeQuizAnswerChoices(value: unknown): QuizAnswerChoice[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((choice) => {
      if (!choice || typeof choice !== 'object') return null;
      const id = typeof choice.id === 'string' ? choice.id.trim() : '';
      const label = typeof choice.label === 'string' ? choice.label.trim() : '';
      const body = typeof choice.body === 'string' ? choice.body : '';
      if (!id || !label) return null;
      return { id, label, body };
    })
    .filter((choice): choice is QuizAnswerChoice => choice !== null);
}

function normalizeQuizArtifact(artifact: Partial<QuizArtifact> | null | undefined): QuizArtifact | null {
  if (!artifact || typeof artifact !== 'object') return null;
  const type = artifact.type === 'graph' ? 'graph' : artifact.type === 'image' ? 'image' : null;
  const alt = typeof artifact.alt === 'string' ? artifact.alt : '';
  if (type === null) return null;
  return {
    type,
    alt,
    imageUrl: normalizeNullableString(artifact.imageUrl),
    graphSpec:
      artifact.graphSpec && typeof artifact.graphSpec === 'object'
        ? (artifact.graphSpec as Record<string, unknown>)
        : null,
  };
}

function normalizeQuizPrompt(prompt: Partial<QuizPrompt> | null | undefined): QuizPrompt | null {
  if (!prompt || typeof prompt !== 'object') return null;
  const sessionId = typeof prompt.sessionId === 'string' ? prompt.sessionId.trim() : '';
  const questionId = typeof prompt.questionId === 'string' ? prompt.questionId.trim() : '';
  const packId = typeof prompt.packId === 'string' ? prompt.packId.trim() : '';
  const topicId = typeof prompt.topicId === 'string' ? prompt.topicId.trim() : '';
  const topicLabel = typeof prompt.topicLabel === 'string' ? prompt.topicLabel.trim() : '';
  const packTitle = typeof prompt.packTitle === 'string' ? prompt.packTitle.trim() : '';
  const chapterTitle = typeof prompt.chapterTitle === 'string' ? prompt.chapterTitle.trim() : '';
  const body = typeof prompt.prompt === 'string' ? prompt.prompt.trim() : '';
  if (!sessionId || !questionId || !packId || !topicId || !topicLabel || !packTitle || !chapterTitle || !body) {
    return null;
  }
  return {
    sessionId,
    questionId,
    progressId: normalizeNullableString(prompt.progressId),
    packId,
    packVersionId: normalizeNullableString(prompt.packVersionId),
    topicId,
    topicLabel,
    packTitle,
    chapterTitle,
    difficulty:
      prompt.difficulty === 'easy' || prompt.difficulty === 'medium' || prompt.difficulty === 'hard'
        ? prompt.difficulty
        : 'easy',
    origin:
      prompt.origin === 'manual' || prompt.origin === 'retry' || prompt.origin === 'scheduled'
        ? prompt.origin
        : 'manual',
    pointsReward: normalizeNumber(prompt.pointsReward),
    streak: normalizeNumber(prompt.streak),
    prompt: body,
    hint: normalizeNullableString(prompt.hint),
    explanation: normalizeNullableString(prompt.explanation),
    choices: normalizeQuizAnswerChoices(prompt.choices),
    correctChoiceId: normalizeNullableString(prompt.correctChoiceId),
    wrongAnswerExplanations:
      prompt.wrongAnswerExplanations && typeof prompt.wrongAnswerExplanations === 'object'
        ? Object.entries(prompt.wrongAnswerExplanations as Record<string, unknown>).reduce<Record<string, string>>(
            (acc, [key, value]) => {
              if (typeof value === 'string') acc[key] = value;
              return acc;
            },
            {},
          )
        : {},
    artifact: normalizeQuizArtifact(prompt.artifact),
    surfacedAt: typeof prompt.surfacedAt === 'string' ? prompt.surfacedAt : new Date(0).toISOString(),
  };
}

function normalizeLearningStateStored(
  state: Partial<LearningState> | null | undefined,
): LearningState {
  return {
    ...DEFAULT_LEARNING_STATE,
    ...state,
    taxonomy: Array.isArray(state?.taxonomy)
      ? state.taxonomy
          .map((subject) => normalizeLearningSubject(subject))
          .filter((subject): subject is LearningSubject => subject !== null)
      : [],
    userTopics: Array.isArray(state?.userTopics)
      ? state.userTopics
          .map((topic) => normalizeUserLearningTopic(topic))
          .filter((topic): topic is UserLearningTopic => topic !== null)
      : [],
    suggestions: Array.isArray(state?.suggestions)
      ? state.suggestions
          .map((suggestion) => normalizeLearningSuggestion(suggestion))
          .filter((suggestion): suggestion is LearningSuggestion => suggestion !== null)
      : [],
    packs: Array.isArray(state?.packs)
      ? state.packs
          .map((pack) => normalizeQuizPackSummary(pack))
          .filter((pack): pack is QuizPackSummary => pack !== null)
      : [],
    reviewQueue: Array.isArray(state?.reviewQueue)
      ? state.reviewQueue
          .map((item) => normalizeReviewQueueItem(item))
          .filter((item): item is ReviewQueueItem => item !== null)
      : [],
    activeQuizPrompt: normalizeQuizPrompt(state?.activeQuizPrompt),
    activeQuizVisible: normalizeBoolean(state?.activeQuizVisible, false),
    syncing: normalizeBoolean(state?.syncing, false),
    lastSyncedAt: normalizeNullableString(state?.lastSyncedAt),
    lastError: normalizeNullableString(state?.lastError),
  };
}

// ─── Profiles ────────────────────────────────────────────────────────────────

export const getProfiles = (): Promise<Profiles> =>
  get<Profiles>('profiles', {});

export const setProfiles = (profiles: Profiles): Promise<void> =>
  set('profiles', profiles);

// ─── Global allowlist ─────────────────────────────────────────────────────────

export const getGlobalAllowlist = (): Promise<string[]> =>
  get<string[]>('globalAllowlist', DEFAULT_GLOBAL_ALLOWLIST);

export const setGlobalAllowlist = (list: string[]): Promise<void> =>
  set('globalAllowlist', list);

// ─── Event bindings ───────────────────────────────────────────────────────────

export const getEventBindings = (): Promise<EventBindings> =>
  get<EventBindings>('eventBindings', {});

export const setEventBindings = (bindings: EventBindings): Promise<void> =>
  set('eventBindings', bindings);

// ─── Event rules ─────────────────────────────────────────────────────────────

export const getEventRules = (): Promise<EventRule[]> =>
  get<EventRule[]>('eventRules', []).then(normalizeEventRulesStored);

export const setEventRules = (rules: EventRule[]): Promise<void> =>
  set('eventRules', normalizeEventRulesStored(rules));

// ─── Keyword rules ───────────────────────────────────────────────────────────

export const getKeywordRules = (): Promise<KeywordRule[]> =>
  get<KeywordRule[]>('keywordRules', []).then(normalizeKeywordRulesStored);

export const setKeywordRules = (rules: KeywordRule[]): Promise<void> =>
  set('keywordRules', normalizeKeywordRulesStored(rules));

// ─── Task tags ───────────────────────────────────────────────────────────────

export const getTaskTags = (): Promise<TaskTag[]> =>
  get<TaskTag[]>('taskTags', DEFAULT_TASK_TAGS).then(ensureDefaultTaskTags);

export const setTaskTags = (tags: TaskTag[]): Promise<void> =>
  set('taskTags', ensureDefaultTaskTags(tags));

export const getExtendedTaskSets = async (): Promise<ExtendedTaskSet[]> => {
  const local = normalizeExtendedTaskSetsStored(
    await getLocal<ExtendedTaskSet[]>('extendedTaskSets', DEFAULT_EXTENDED_TASK_SETS),
  );
  if (local.length > 0) {
    return local;
  }

  const legacySync = normalizeExtendedTaskSetsStored(
    await get<ExtendedTaskSet[]>('extendedTaskSets', DEFAULT_EXTENDED_TASK_SETS),
  );
  if (legacySync.length > 0) {
    await Promise.all([
      setLocal('extendedTaskSets', legacySync),
      remove('extendedTaskSets'),
    ]);
    return legacySync;
  }

  return local;
};

export const setExtendedTaskSets = async (taskSets: ExtendedTaskSet[]): Promise<void> => {
  const normalized = normalizeExtendedTaskSetsStored(taskSets);
  await Promise.all([
    setLocal('extendedTaskSets', normalized),
    remove('extendedTaskSets'),
  ]);
};

export const clearExtendedTaskSets = (): Promise<void> =>
  Promise.all([
    removeLocal('extendedTaskSets'),
    remove('extendedTaskSets'),
  ]).then(() => undefined);

export const getExtendedTaskAssignments = async (): Promise<ExtendedTaskAssignment[]> => {
  const local = normalizeExtendedTaskAssignmentsStored(
    await getLocal<ExtendedTaskAssignment[]>('extendedTaskAssignments', DEFAULT_EXTENDED_TASK_ASSIGNMENTS),
  );
  if (local.length > 0) {
    return local;
  }

  const legacySync = normalizeExtendedTaskAssignmentsStored(
    await get<ExtendedTaskAssignment[]>('extendedTaskAssignments', DEFAULT_EXTENDED_TASK_ASSIGNMENTS),
  );
  if (legacySync.length > 0) {
    await Promise.all([
      setLocal('extendedTaskAssignments', legacySync),
      remove('extendedTaskAssignments'),
    ]);
    return legacySync;
  }

  return local;
};

export const setExtendedTaskAssignments = async (assignments: ExtendedTaskAssignment[]): Promise<void> => {
  const normalized = normalizeExtendedTaskAssignmentsStored(assignments);
  await Promise.all([
    setLocal('extendedTaskAssignments', normalized),
    remove('extendedTaskAssignments'),
  ]);
};

export const clearExtendedTaskAssignments = (): Promise<void> =>
  Promise.all([
    removeLocal('extendedTaskAssignments'),
    remove('extendedTaskAssignments'),
  ]).then(() => undefined);

// ─── Settings ─────────────────────────────────────────────────────────────────

export const getSettings = (): Promise<Settings> =>
  get<Partial<Settings>>('settings', DEFAULT_SETTINGS).then(normalizeSettingsStored);

export const setSettings = (settings: Settings): Promise<void> =>
  set('settings', normalizeSettingsStored(settings));

// ─── Assistant options ───────────────────────────────────────────────────────

export const getAssistantOptions = (): Promise<AssistantOptions> =>
  get<Partial<AssistantOptions>>('assistantOptions', DEFAULT_ASSISTANT_OPTIONS).then(normalizeAssistantOptionsStored);

export const setAssistantOptions = (options: AssistantOptions): Promise<void> =>
  set('assistantOptions', options);

// ─── Task queue ───────────────────────────────────────────────────────────────

export const getTaskQueue = (): Promise<Task[]> =>
  get<Task[]>('taskQueue', []);

export const setTaskQueue = (queue: Task[]): Promise<void> =>
  set('taskQueue', queue);

// ─── Snooze state ─────────────────────────────────────────────────────────────

export const getSnoozeState = (): Promise<SnoozeState> =>
  get<SnoozeState>('snoozeState', DEFAULT_SNOOZE_STATE);

export const setSnoozeState = (state: SnoozeState): Promise<void> =>
  set('snoozeState', state);

// ─── Points history ───────────────────────────────────────────────────────────

export const getPointsHistory = (): Promise<PointsHistory> =>
  get<PointsHistory>('pointsHistory', {});

export const setPointsHistory = (history: PointsHistory): Promise<void> =>
  set('pointsHistory', history);

// ─── All-time stats ───────────────────────────────────────────────────────────

export const getAllTimeStats = (): Promise<AllTimeStats> =>
  get<AllTimeStats>('allTimeStats', DEFAULT_ALL_TIME_STATS);

export const setAllTimeStats = (stats: AllTimeStats): Promise<void> =>
  set('allTimeStats', stats);

// ─── Weekly stats helpers ─────────────────────────────────────────────────────

/** Returns an ISO week key like "2026-W14". */
export function getWeekKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const weekNum = Math.ceil(
    ((date.getTime() - jan1.getTime()) / 86_400_000 + jan1.getDay() + 1) / 7,
  );
  return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

const emptyWeeklyStats = (): WeeklyStats => ({
  earned: 0,
  tasksCompleted: 0,
  tasksDismissed: 0,
  tasksExpired: 0,
  snoozesUsed: 0,
  perfectDays: 0,
  longestStreak: 0,
});

export async function getCurrentWeekStats(): Promise<WeeklyStats> {
  const history = await getPointsHistory();
  return history[getWeekKey()] ?? emptyWeeklyStats();
}

export async function updateCurrentWeekStats(update: Partial<WeeklyStats>): Promise<void> {
  const history = await getPointsHistory();
  const key = getWeekKey();
  history[key] = { ...(history[key] ?? emptyWeeklyStats()), ...update };
  await setPointsHistory(history);
}

// ─── Calendar state ───────────────────────────────────────────────────────────

const DEFAULT_CALENDAR_STATE: CalendarState = {
  currentEvent: null,
  activeLaunchTarget: null,
  allActiveEvents: [],
  todaysEvents: [],
  activeProfile: null,
  activeRuleSource: 'none' as ActiveRuleSource,
  activeRuleName: null,
  primaryTagKey: null,
  primaryTagLabel: null,
  secondaryTagKeys: [],
  secondaryTagLabels: [],
  difficultyRank: null,
  allowedDomains: [],
  recentEventTitles: [],
  isRestricted: false,
  lastSyncedAt: null,
  authError: null,
};

export const getCalendarState = (): Promise<CalendarState> =>
  get<CalendarState>('calendarState', DEFAULT_CALENDAR_STATE).then(normalizeCalendarStateStored);

export const setCalendarState = (state: CalendarState): Promise<void> =>
  set('calendarState', normalizeCalendarStateStored(state));

export const getEventLaunchTargets = (): Promise<EventLaunchTarget[]> =>
  get<EventLaunchTarget[]>('eventLaunchTargets', []);

export const setEventLaunchTargets = (targets: EventLaunchTarget[]): Promise<void> =>
  set('eventLaunchTargets', targets);

// ─── Local backend state ─────────────────────────────────────────────────────

export const getBackendSession = (): Promise<BackendSession | null> =>
  getLocal<BackendSession | null>('backendSession', null);

export const setBackendSession = (session: BackendSession | null): Promise<void> =>
  setLocal('backendSession', session);

export const getAccountUser = (): Promise<AccountUser | null> =>
  getLocal<AccountUser | null>('accountUser', null);

export const setAccountUser = (user: AccountUser | null): Promise<void> =>
  setLocal('accountUser', user);

export const getAccountSyncState = (): Promise<AccountSyncState> =>
  getLocal<AccountSyncState>('accountSyncState', DEFAULT_ACCOUNT_SYNC_STATE);

export const setAccountSyncState = (state: AccountSyncState): Promise<void> =>
  setLocal('accountSyncState', state);

export const getAccountConflict = (): Promise<AccountConflict | null> =>
  getLocal<AccountConflict | null>('accountConflict', null);

export const setAccountConflict = (conflict: AccountConflict | null): Promise<void> =>
  setLocal('accountConflict', conflict);

export const getBackendSyncState = (): Promise<BackendSyncState> =>
  getLocal<BackendSyncState>('backendSyncState', DEFAULT_BACKEND_SYNC_STATE);

export const setBackendSyncState = (state: BackendSyncState): Promise<void> =>
  setLocal('backendSyncState', state);

export const getIdeaRecords = (): Promise<IdeaRecord[]> =>
  getLocal<IdeaRecord[]>('ideaRecords', []);

export const setIdeaRecords = (items: IdeaRecord[]): Promise<void> =>
  setLocal('ideaRecords', items);

export const getOpenClawState = (): Promise<OpenClawState> =>
  getLocal<Partial<OpenClawState>>('openClawState', DEFAULT_OPENCLAW_STATE).then(normalizeOpenClawStateStored);

export const setOpenClawState = (state: OpenClawState): Promise<void> =>
  setLocal('openClawState', state);

export const getLearningState = (): Promise<LearningState> =>
  getLocal<Partial<LearningState>>('learningState', DEFAULT_LEARNING_STATE).then(
    normalizeLearningStateStored,
  );

export const setLearningState = (state: LearningState): Promise<void> =>
  setLocal('learningState', normalizeLearningStateStored(state));

export const getBreakVisitQueue = (): Promise<BreakVisitEvent[]> =>
  getLocal<BreakVisitEvent[]>('breakVisitQueue', []);

export const setBreakVisitQueue = (events: BreakVisitEvent[]): Promise<void> =>
  setLocal('breakVisitQueue', events);

export const getActiveBreakVisits = (): Promise<Record<string, BreakVisitEvent>> =>
  getLocal<Record<string, BreakVisitEvent>>('activeBreakVisits', {});

export const setActiveBreakVisits = (events: Record<string, BreakVisitEvent>): Promise<void> =>
  setLocal('activeBreakVisits', events);

export const getActiveFocusSession = (): Promise<ActiveFocusSessionState | null> =>
  getLocal<ActiveFocusSessionState | null>('activeFocusSession', null).then((session) =>
    normalizeActiveFocusSessionState(session),
  );

export const setActiveFocusSession = (
  session: ActiveFocusSessionState | null,
): Promise<void> => setLocal(
  'activeFocusSession',
  session ? normalizeActiveFocusSessionState(session) : null,
);

export const getActiveActivitySession = (): Promise<ActiveActivitySessionState | null> =>
  getLocal<ActiveActivitySessionState | null>('activeActivitySession', null).then((session) =>
    normalizeActivitySessionRecord(session) as ActiveActivitySessionState | null,
  );

export const setActiveActivitySession = (
  session: ActiveActivitySessionState | null,
): Promise<void> => setLocal(
  'activeActivitySession',
  session ? normalizeActivitySessionRecord(session) : null,
);

export const getActiveLocalActivity = (): Promise<ActiveLocalActivityState | null> =>
  getLocal<ActiveLocalActivityState | null>('activeLocalActivity', null).then((session) =>
    normalizeLocalActivityRecord(session) as ActiveLocalActivityState | null,
  );

export const setActiveLocalActivity = (
  session: ActiveLocalActivityState | null,
): Promise<void> => setLocal(
  'activeLocalActivity',
  session ? normalizeLocalActivityRecord(session) : null,
);

export const getActivitySessionQueue = (): Promise<ActivitySessionRecord[]> =>
  getLocal<ActivitySessionRecord[]>('activitySessionQueue', []).then(normalizeActivitySessionRecords);

export const setActivitySessionQueue = (items: ActivitySessionRecord[]): Promise<void> =>
  setLocal('activitySessionQueue', normalizeActivitySessionRecords(items));

export const getFocusSessionQueue = (): Promise<FocusSessionRecord[]> =>
  getLocal<FocusSessionRecord[]>('focusSessionQueue', []).then(normalizeFocusSessionRecords);

export const setFocusSessionQueue = (items: FocusSessionRecord[]): Promise<void> =>
  setLocal('focusSessionQueue', normalizeFocusSessionRecords(items));

export const getActivityHistory = (): Promise<ActivitySessionRecord[]> =>
  getLocal<ActivitySessionRecord[]>('activityHistory', []).then(normalizeActivitySessionRecords);

export const setActivityHistory = (items: ActivitySessionRecord[]): Promise<void> =>
  setLocal('activityHistory', normalizeActivitySessionRecords(items));

export const getLocalActivityHistory = (): Promise<LocalActivityRecord[]> =>
  getLocal<LocalActivityRecord[]>('localActivityHistory', []).then(normalizeLocalActivityRecords);

export const setLocalActivityHistory = (items: LocalActivityRecord[]): Promise<void> =>
  setLocal('localActivityHistory', normalizeLocalActivityRecords(items));

export const getFocusSessionHistory = (): Promise<FocusSessionRecord[]> =>
  getLocal<FocusSessionRecord[]>('focusSessionHistory', []).then(normalizeFocusSessionRecords);

export const setFocusSessionHistory = (items: FocusSessionRecord[]): Promise<void> =>
  setLocal('focusSessionHistory', normalizeFocusSessionRecords(items));

export const getAnalyticsSnapshot = (): Promise<AnalyticsSnapshot> =>
  getLocal<AnalyticsSnapshot>('analyticsSnapshot', DEFAULT_ANALYTICS_SNAPSHOT).then(
    normalizeAnalyticsSnapshotStored,
  );

export const setAnalyticsSnapshot = (snapshot: AnalyticsSnapshot): Promise<void> =>
  setLocal('analyticsSnapshot', normalizeAnalyticsSnapshotStored(snapshot));

export const getDailyConsumptionRollups = (): Promise<DailyConsumptionRollupStore> =>
  getLocal<DailyConsumptionRollupStore>('dailyConsumptionRollups', {}).then(normalizeDailyConsumptionRollupStore);

export const setDailyConsumptionRollups = (store: DailyConsumptionRollupStore): Promise<void> =>
  setLocal('dailyConsumptionRollups', normalizeDailyConsumptionRollupStore(store));

export const getEventPatternStats = (): Promise<EventPatternStat[]> =>
  getLocal<EventPatternStat[]>('eventPatternStats', []);

export const setEventPatternStats = (stats: EventPatternStat[]): Promise<void> =>
  setLocal('eventPatternStats', stats);

export const getBlockedTabs = (): Promise<Record<string, BlockedTabState>> =>
  getLocal<Record<string, BlockedTabState>>('blockedTabs', {});

export const setBlockedTabs = (tabs: Record<string, BlockedTabState>): Promise<void> =>
  setLocal('blockedTabs', tabs);

export const getLaunchExecutionStates = (): Promise<Record<string, LaunchExecutionState>> =>
  getLocal<Record<string, LaunchExecutionState>>('launchExecutionStates', {});

export const setLaunchExecutionStates = (
  states: Record<string, LaunchExecutionState>,
): Promise<void> => setLocal('launchExecutionStates', states);

export const getTemporaryUnlocks = (): Promise<Record<string, TemporaryUnlockState>> =>
  getLocal<Record<string, TemporaryUnlockState>>('temporaryUnlocks', {});

export const setTemporaryUnlocks = (unlocks: Record<string, TemporaryUnlockState>): Promise<void> =>
  setLocal('temporaryUnlocks', unlocks);

export const getDownloadAllowances = (): Promise<Record<string, DownloadAllowance>> =>
  getLocal<Record<string, DownloadAllowance>>('downloadAllowances', {});

export const setDownloadAllowances = (allowances: Record<string, DownloadAllowance>): Promise<void> =>
  setLocal('downloadAllowances', allowances);

export const getTabDocumentUrls = (): Promise<Record<string, string>> =>
  getLocal<Record<string, string>>('tabDocumentUrls', {});

export const setTabDocumentUrls = (tabDocumentUrls: Record<string, string>): Promise<void> =>
  setLocal('tabDocumentUrls', tabDocumentUrls);

export const getUnlockSpendState = (): Promise<UnlockSpendState> =>
  getLocal<UnlockSpendState>('unlockSpendState', { activeEventKey: null, spendCount: 0 });

export const setUnlockSpendState = (state: UnlockSpendState): Promise<void> =>
  setLocal('unlockSpendState', state);

export const getDemoStatsSeedVersion = (): Promise<number> =>
  getLocal<number>('demoStatsSeedVersion', 0);

export const setDemoStatsSeedVersion = (version: number): Promise<void> =>
  setLocal('demoStatsSeedVersion', version);

// ─── Bulk read (for service worker rehydration) ───────────────────────────────

export function getAllStorageData(): Promise<Partial<StorageData>> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(null, (result) => {
      resolve(result as Partial<StorageData>);
    });
  });
}
