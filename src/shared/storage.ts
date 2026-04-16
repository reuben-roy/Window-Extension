import type {
  ActiveActivitySessionState,
  ActiveFocusSessionState,
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
  CalendarState,
  DownloadAllowance,
  EventPatternStat,
  EventRule,
  EventBindings,
  FocusSessionRecord,
  IdeaRecord,
  KeywordRule,
  OpenClawState,
  PointsHistory,
  Profiles,
  Settings,
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
  DEFAULT_GLOBAL_ALLOWLIST,
  DEFAULT_OPENCLAW_STATE,
  DEFAULT_SETTINGS,
  DEFAULT_SNOOZE_STATE,
  DEFAULT_TASK_TAGS,
} from './constants';

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

function getLocal<T>(key: string, defaultValue: T): Promise<T> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      resolve(result[key] !== undefined ? (result[key] as T) : defaultValue);
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
  get<EventRule[]>('eventRules', []);

export const setEventRules = (rules: EventRule[]): Promise<void> =>
  set('eventRules', rules);

// ─── Keyword rules ───────────────────────────────────────────────────────────

export const getKeywordRules = (): Promise<KeywordRule[]> =>
  get<KeywordRule[]>('keywordRules', []);

export const setKeywordRules = (rules: KeywordRule[]): Promise<void> =>
  set('keywordRules', rules);

// ─── Task tags ───────────────────────────────────────────────────────────────

export const getTaskTags = (): Promise<TaskTag[]> =>
  get<TaskTag[]>('taskTags', DEFAULT_TASK_TAGS);

export const setTaskTags = (tags: TaskTag[]): Promise<void> =>
  set('taskTags', tags);

// ─── Settings ─────────────────────────────────────────────────────────────────

export const getSettings = (): Promise<Settings> =>
  get<Partial<Settings>>('settings', DEFAULT_SETTINGS).then((settings) => ({
    ...DEFAULT_SETTINGS,
    ...settings,
  }));

export const setSettings = (settings: Settings): Promise<void> =>
  set('settings', settings);

// ─── Assistant options ───────────────────────────────────────────────────────

export const getAssistantOptions = (): Promise<AssistantOptions> =>
  get<AssistantOptions>('assistantOptions', DEFAULT_ASSISTANT_OPTIONS);

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
  allActiveEvents: [],
  todaysEvents: [],
  activeProfile: null,
  activeRuleSource: 'none' as ActiveRuleSource,
  activeRuleName: null,
  primaryTagKey: null,
  primaryTagLabel: null,
  difficultyRank: null,
  allowedDomains: [],
  recentEventTitles: [],
  isRestricted: false,
  lastSyncedAt: null,
  authError: null,
};

export const getCalendarState = (): Promise<CalendarState> =>
  get<CalendarState>('calendarState', DEFAULT_CALENDAR_STATE);

export const setCalendarState = (state: CalendarState): Promise<void> =>
  set('calendarState', state);

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
  getLocal<OpenClawState>('openClawState', DEFAULT_OPENCLAW_STATE);

export const setOpenClawState = (state: OpenClawState): Promise<void> =>
  setLocal('openClawState', state);

export const getBreakVisitQueue = (): Promise<BreakVisitEvent[]> =>
  getLocal<BreakVisitEvent[]>('breakVisitQueue', []);

export const setBreakVisitQueue = (events: BreakVisitEvent[]): Promise<void> =>
  setLocal('breakVisitQueue', events);

export const getActiveBreakVisits = (): Promise<Record<string, BreakVisitEvent>> =>
  getLocal<Record<string, BreakVisitEvent>>('activeBreakVisits', {});

export const setActiveBreakVisits = (events: Record<string, BreakVisitEvent>): Promise<void> =>
  setLocal('activeBreakVisits', events);

export const getActiveFocusSession = (): Promise<ActiveFocusSessionState | null> =>
  getLocal<ActiveFocusSessionState | null>('activeFocusSession', null);

export const setActiveFocusSession = (
  session: ActiveFocusSessionState | null,
): Promise<void> => setLocal('activeFocusSession', session);

export const getActiveActivitySession = (): Promise<ActiveActivitySessionState | null> =>
  getLocal<ActiveActivitySessionState | null>('activeActivitySession', null);

export const setActiveActivitySession = (
  session: ActiveActivitySessionState | null,
): Promise<void> => setLocal('activeActivitySession', session);

export const getActivitySessionQueue = (): Promise<ActivitySessionRecord[]> =>
  getLocal<ActivitySessionRecord[]>('activitySessionQueue', []);

export const setActivitySessionQueue = (items: ActivitySessionRecord[]): Promise<void> =>
  setLocal('activitySessionQueue', items);

export const getFocusSessionQueue = (): Promise<FocusSessionRecord[]> =>
  getLocal<FocusSessionRecord[]>('focusSessionQueue', []);

export const setFocusSessionQueue = (items: FocusSessionRecord[]): Promise<void> =>
  setLocal('focusSessionQueue', items);

export const getActivityHistory = (): Promise<ActivitySessionRecord[]> =>
  getLocal<ActivitySessionRecord[]>('activityHistory', []);

export const setActivityHistory = (items: ActivitySessionRecord[]): Promise<void> =>
  setLocal('activityHistory', items);

export const getFocusSessionHistory = (): Promise<FocusSessionRecord[]> =>
  getLocal<FocusSessionRecord[]>('focusSessionHistory', []);

export const setFocusSessionHistory = (items: FocusSessionRecord[]): Promise<void> =>
  setLocal('focusSessionHistory', items);

export const getAnalyticsSnapshot = (): Promise<AnalyticsSnapshot> =>
  getLocal<AnalyticsSnapshot>('analyticsSnapshot', DEFAULT_ANALYTICS_SNAPSHOT);

export const setAnalyticsSnapshot = (snapshot: AnalyticsSnapshot): Promise<void> =>
  setLocal('analyticsSnapshot', snapshot);

export const getEventPatternStats = (): Promise<EventPatternStat[]> =>
  getLocal<EventPatternStat[]>('eventPatternStats', []);

export const setEventPatternStats = (stats: EventPatternStat[]): Promise<void> =>
  setLocal('eventPatternStats', stats);

export const getBlockedTabs = (): Promise<Record<string, BlockedTabState>> =>
  getLocal<Record<string, BlockedTabState>>('blockedTabs', {});

export const setBlockedTabs = (tabs: Record<string, BlockedTabState>): Promise<void> =>
  setLocal('blockedTabs', tabs);

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
