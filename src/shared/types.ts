// Task lifecycle statuses
export type TaskStatus = 'active' | 'carryover' | 'completed' | 'dismissed' | 'expired';

// Carryover stacking mode
export type CarryoverMode = 'union' | 'intersection';

export type BreakDurationMinutes = 5 | 10 | 15;
export type DownloadRedirectFallbackSeconds = 1 | 2 | 3 | 4 | 5;
export type AuthProvider = 'google' | 'github' | 'password';
export type IdeaJobStatus =
  | 'queued'
  | 'syncing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'kept'
  | 'discarded';
export type IdeaDecision = 'keep' | 'discard';
export type OpenClawSessionStatus = 'active' | 'idle' | 'closed';
export type OpenClawJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type OpenClawTransport = 'ssh' | 'http' | 'unknown';
export type AssistantConnectorType = 'openclaw';
export type AssistantTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type TaskNotificationMode = 'immediate' | 'after_focus' | 'inbox_only';
export type AssistantFocusContextType = 'none' | 'window_task' | 'calendar_event';
export type RecommendationKind = 'focus' | 'calendar' | 'interest' | 'automation';
export type DifficultyRank = 1 | 2 | 3 | 5 | 8;
export type ActivityClass = 'aligned' | 'supportive' | 'distracted' | 'away' | 'break';
export type TaskTagSource = 'seed' | 'keyword' | 'auto' | 'user';
export type AnalyticsRange = '7d' | '30d';

export interface TaskTag {
  key: string;
  label: string;
  color: string;
  aliases: string[];
  baselineDifficulty: DifficultyRank;
  alignedDomains: string[];
  supportiveDomains: string[];
  source: TaskTagSource;
  archivedAt: string | null;
  updatedAt: string;
}

export interface EventRule {
  eventTitle: string;
  domains: string[];
  tagKey: string | null;
  secondaryTagKeys: string[];
  difficultyOverride: DifficultyRank | null;
}

export interface KeywordRule {
  keyword: string;
  domains: string[];
  createdAt: string;
  tagKey: string | null;
}

export type ActiveRuleSource = 'event' | 'keyword' | 'none';

// Extension settings
export interface Settings {
  enableBlocking: boolean;
  blockPage: string;
  carryoverMode: CarryoverMode;
  taskTTLDays: number;
  monthlyResetEnabled: boolean;
  lastMonthlyReset: string; // ISO string
  minBlockDurationMinutes: number;
  breakDurationMinutes: BreakDurationMinutes;
  keywordAutoMatchEnabled: boolean;
  breakTelemetryEnabled: boolean;
  persistentPanelEnabled: boolean;
  dailyBlockingPauseEnabled: boolean;
  dailyBlockingPauseStartTime: string;
  downloadRedirectFallbackSeconds: DownloadRedirectFallbackSeconds;
  downloadRedirectUseDownloadsApi: boolean;
  downloadRedirectFallbackPatternMatchEnabled: boolean;
  downloadRedirectFallbackSameHostEnabled: boolean;
  downloadRedirectFallbackSameSiteEnabled: boolean;
  downloadRedirectFallbackAnyAllowedRedirectEnabled: boolean;
  downloadRedirectAllowAcrossTabsEnabled: boolean;
  downloadRedirectProgrammaticDownloadEnabled: boolean;
}

// Profile map: profile name → list of allowed domains
export type Profiles = Record<string, string[]>;

// Event binding map: keyword/pattern → profile name
export type EventBindings = Record<string, string>;

// A task in the queue (maps one-to-one with a calendar event)
export interface Task {
  id: string;
  eventTitle: string;
  calendarEventId: string;
  profile: string;
  scheduledStart: string; // ISO string
  scheduledEnd: string;   // ISO string
  status: TaskStatus;
  carriedOverAt: string | null;  // ISO string, set when status → 'carryover'
  expiresAt: string | null;      // ISO string, set when status → 'carryover'
  completionNote: string | null;
  snoozesUsed: number;
  maxSnoozes: number;
}

// Snooze session state
export interface SnoozeState {
  active: boolean;
  expiresAt: string | null; // ISO string
  taskId: string | null;
  snoozesUsed: number;
  maxSnoozes: number;
  cooldownSeconds: number;
  durationMinutes: BreakDurationMinutes;
}

// Per-week aggregated stats (key: "YYYY-Www")
export interface WeeklyStats {
  earned: number;
  tasksCompleted: number;
  tasksDismissed: number;
  tasksExpired: number;
  snoozesUsed: number;
  perfectDays: number;
  longestStreak: number;
}

export type PointsHistory = Record<string, WeeklyStats>;

// All-time cumulative stats
export interface AllTimeStats {
  totalPoints: number;
  level: number;
  title: string;
  prestigeCount: number;
  tasksCompleted: number;
  bestWeek: number;
  currentWeekStreak: number;
}

export interface AccountUser {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  providers: AuthProvider[];
  createdAt: string;
}

export interface AccountSession {
  sessionToken: string;
  userId: string;
  expiresAt: string;
  connectedAt: string;
}

export type BackendSession = AccountSession;

export interface AccountSnapshot {
  allTimeStats: AllTimeStats;
  pointsHistory: PointsHistory;
  profiles: Profiles;
  eventBindings: EventBindings;
  eventRules: EventRule[];
  keywordRules: KeywordRule[];
  taskTags: TaskTag[];
  globalAllowlist: string[];
}

export interface AccountSyncState {
  configured: boolean;
  connected: boolean;
  syncing: boolean;
  initialized: boolean;
  revision: number;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface AccountConflict {
  local: AccountSnapshot;
  remote: AccountSnapshot;
  remoteRevision: number;
  detectedAt: string;
}

export interface BackendSyncState {
  configured: boolean;
  connected: boolean;
  syncing: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface IdeaReport {
  summary: string;
  viability: 'low' | 'moderate' | 'high' | 'unknown';
  competitionSnapshot: string;
  buildEffort: string;
  revenuePotential: string;
  risks: string[];
  nextSteps: string[];
  sourceLinks: string[];
  completedAt: string;
}

export interface IdeaRecord {
  localId: string;
  remoteId: string | null;
  prompt: string;
  status: IdeaJobStatus;
  createdAt: string;
  updatedAt: string;
  unread: boolean;
  saved: boolean;
  archived: boolean;
  error: string | null;
  sessionId: string | null;
  jobId: string | null;
  report: IdeaReport | null;
}

export interface IdeaState {
  items: IdeaRecord[];
  outboxDepth: number;
  unreadCount: number;
  lastError: string | null;
  lastSyncedAt: string | null;
}

export interface OpenClawSessionSummary {
  id: string;
  title: string;
  status: OpenClawSessionStatus;
  modelLabel: string | null;
  startedAt: string;
  lastActivityAt: string;
}

export interface OpenClawJobSummary {
  id: string;
  ideaId: string | null;
  title: string;
  status: OpenClawJobStatus;
  startedAt: string | null;
  updatedAt: string;
}

export interface OpenClawConnectionStatus {
  connected: boolean;
  healthy: boolean;
  transport: OpenClawTransport;
  label: string | null;
  message: string | null;
  lastCheckedAt: string | null;
}

export interface AssistantConnectorSummary {
  id: string;
  key: string;
  label: string;
  connectorType: AssistantConnectorType;
  transport: OpenClawTransport;
  enabled: boolean;
  host: string | null;
  baseUrl: string | null;
  description: string | null;
}

export interface AssistantTaskResult {
  summary: string;
  output: string;
  completedAt: string;
}

export interface AssistantTaskRecord {
  id: string;
  connectorId: string | null;
  title: string;
  prompt: string;
  status: AssistantTaskStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
  sessionId: string | null;
  jobId: string | null;
  unread: boolean;
  notificationMode: TaskNotificationMode;
  focusContextType: AssistantFocusContextType;
  focusContextId: string | null;
  notifiedAt: string | null;
  result: AssistantTaskResult | null;
}

export interface OpenClawState {
  status: OpenClawConnectionStatus;
  connectors: AssistantConnectorSummary[];
  selectedConnectorId: string | null;
  sessions: OpenClawSessionSummary[];
  activeSessionId: string | null;
  currentJob: OpenClawJobSummary | null;
  currentTask: AssistantTaskRecord | null;
  tasks: AssistantTaskRecord[];
  lastError: string | null;
}

export interface ModelSelectorState {
  value: string;
  updatedAt: string | null;
}

export interface AssistantOptions {
  preferredModel: ModelSelectorState;
  autoCreateSession: boolean;
  reuseActiveSession: boolean;
  selectedConnectorId: string | null;
  taskNotificationMode: TaskNotificationMode;
  notes: string;
}

export interface BreakVisitEvent {
  id: string;
  tabId: number;
  domain: string;
  startedAt: string;
  endedAt: string;
  activeEventTitle: string | null;
}

export interface EventPatternStat {
  pattern: string;
  label: string;
  occurrences: number;
  correctionCount: number;
  correctedTagKey: string | null;
  autoTagKey: string | null;
  lastSeenAt: string;
}

export interface ActivitySessionRecord {
  id: string;
  focusSessionId: string;
  calendarEventId: string;
  eventTitle: string;
  domain: string | null;
  startedAt: string;
  endedAt: string;
  activityClass: ActivityClass;
  tagKey: string | null;
  secondaryTagKeys: string[];
  difficultyRank: DifficultyRank | null;
  sourceRuleType: ActiveRuleSource;
  sourceRuleName: string | null;
}

export interface FocusSessionRecord {
  id: string;
  calendarEventId: string;
  eventTitle: string;
  scheduledStart: string;
  scheduledEnd: string;
  startedAt: string;
  endedAt: string;
  sourceRuleType: ActiveRuleSource;
  sourceRuleName: string | null;
  tagKey: string | null;
  secondaryTagKeys: string[];
  difficultyRank: DifficultyRank | null;
  productiveMinutes: number;
  supportiveMinutes: number;
  distractedMinutes: number;
  awayMinutes: number;
  breakMinutes: number;
  totalTrackedMinutes: number;
  leftEarly: boolean;
}

export interface ActiveFocusSessionState {
  session: FocusSessionRecord;
  lastProductiveAt: string | null;
}

export interface ActiveActivitySessionState extends ActivitySessionRecord {}

export interface TagBreakdownItem {
  tagKey: string;
  label: string;
  color: string;
  productiveMinutes: number;
  supportiveMinutes: number;
  distractedMinutes: number;
  awayMinutes: number;
  breakMinutes: number;
  sessions: number;
}

export interface DifficultyBreakdownItem {
  difficultyRank: DifficultyRank;
  focusScore: number;
  productiveMinutes: number;
  distractedMinutes: number;
  awayMinutes: number;
  sessions: number;
}

export interface AnalyticsSummary {
  range: AnalyticsRange;
  productiveMinutes: number;
  supportiveMinutes: number;
  distractedMinutes: number;
  awayMinutes: number;
  breakMinutes: number;
  totalFocusSessions: number;
  leftEarlyCount: number;
}

export interface ConsumptionDomainItem {
  domain: string;
  label: string;
  productiveMinutes: number;
  supportiveMinutes: number;
  distractedMinutes: number;
  awayMinutes: number;
  breakMinutes: number;
  totalMinutes: number;
  visits: number;
  primaryActivityClass: ActivityClass;
}

export interface ConsumptionTimelinePoint {
  date: string;
  label: string;
  productiveMinutes: number;
  supportiveMinutes: number;
  distractedMinutes: number;
  awayMinutes: number;
  breakMinutes: number;
  totalMinutes: number;
}

export interface ConsumptionTreeNode {
  id: string;
  label: string;
  depth: number;
  productiveMinutes: number;
  supportiveMinutes: number;
  distractedMinutes: number;
  awayMinutes: number;
  breakMinutes: number;
  totalMinutes: number;
  children: ConsumptionTreeNode[];
}

export interface LiveAnalyticsSession {
  focusSessionId: string;
  eventTitle: string;
  tagKey: string | null;
  tagLabel: string | null;
  secondaryTagKeys: string[];
  secondaryTagLabels: string[];
  difficultyRank: DifficultyRank | null;
  sourceRuleType: ActiveRuleSource;
  sourceRuleName: string | null;
  currentActivityClass: ActivityClass | null;
  startedAt: string;
  scheduledEnd: string;
  productiveMinutes: number;
  supportiveMinutes: number;
  distractedMinutes: number;
  awayMinutes: number;
  breakMinutes: number;
}

export interface AnalyticsSnapshot {
  currentSession: LiveAnalyticsSession | null;
  summary7d: AnalyticsSummary;
  summary30d: AnalyticsSummary;
  tagBreakdown7d: TagBreakdownItem[];
  difficultyBreakdown7d: DifficultyBreakdownItem[];
  domainBreakdown7d: ConsumptionDomainItem[];
  consumptionTimeline7d: ConsumptionTimelinePoint[];
  consumptionTree7d: ConsumptionTreeNode[];
  recentSessions: FocusSessionRecord[];
  lastCalculatedAt: string | null;
  lastSyncedAt: string | null;
}

export interface AnalyticsOverrideInput {
  focusSessionId: string;
  tagKey: string | null;
  difficultyRank: DifficultyRank | null;
}

export interface LocalActivityRecord {
  id: string;
  focusSessionId: string;
  calendarEventId: string;
  eventTitle: string;
  domain: string | null;
  tabTitle: string | null;
  startedAt: string;
  endedAt: string;
  activityClass: ActivityClass;
  primaryTagKey: string | null;
  secondaryTagKeys: string[];
}

export interface ActiveLocalActivityState extends LocalActivityRecord {}

export interface RecommendationCard {
  id: string;
  title: string;
  body: string;
  kind: RecommendationKind;
  createdAt: string;
}

export interface BlockedTabState {
  tabId: number;
  originalUrl: string;
  blockedHost: string;
  activeEventId: string | null;
  activeEventTitle: string | null;
  blockedAt: string;
}

export interface TemporaryUnlockState {
  tabId: number;
  blockedHost: string;
  originalUrl: string;
  expiresAt: string;
  ruleId: number;
  activeEventId: string | null;
  activeEventTitle: string | null;
}

export type DownloadAllowanceType = 'download' | 'fallback';

export interface DownloadAllowance {
  key: string;
  allowanceType: DownloadAllowanceType;
  downloadId: number | null;
  tabId: number | null;
  sourceUrl: string | null;
  sourceHost: string | null;
  targetUrl: string;
  targetHost: string;
  ruleId: number;
  expiresAt: string;
}

export interface UnlockSpendState {
  activeEventKey: string | null;
  spendCount: number;
}

export interface EventLaunchTarget {
  calendarEventId: string;
  eventTitle: string;
  start: string;
  end: string;
  launchUrl: string;
  updatedAt: string;
}

export type LaunchExecutionStatus = 'focused' | 'created' | 'failed';

export interface LaunchExecutionState {
  status: LaunchExecutionStatus;
  handledAt: string;
  tabId?: number;
}

// Google Calendar event (normalized from API response)
export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // ISO string
  end: string;   // ISO string
  isAllDay: boolean;
  description: string | null;
  attendees: string[];
  googleColorId?: string;
  backgroundColor?: string | null;
  foregroundColor?: string | null;
  colorSource?: 'google-event' | 'derived' | 'default';
  recurringEventId?: string;
  recurrenceHint?: string | null;
}

/**
 * Snapshot of what the calendar sync last resolved.
 * Stored in chrome.storage so popups and the blocked page can read it without
 * waiting for a fresh API call.
 */
export interface CalendarState {
  /** The primary event to display (first bound event, or first active if none bound). */
  currentEvent: CalendarEvent | null;
  /** The per-occurrence launch target that should be surfaced and auto-opened right now. */
  activeLaunchTarget: EventLaunchTarget | null;
  /** All calendar events currently in progress (handles overlapping). */
  allActiveEvents: CalendarEvent[];
  /** All timed calendar events fetched for the current day. */
  todaysEvents: CalendarEvent[];
  /**
   * Resolved profile name for display. When multiple overlapping events are
   * bound to different profiles, this is the first-matched profile name.
   * null = no binding → unrestricted browsing.
   */
  activeProfile: string | null;
  /** Indicates whether the active restriction came from an exact event rule, keyword fallback, or no rule. */
  activeRuleSource: ActiveRuleSource;
  /** Event title for exact rules, keyword text for keyword fallback, null when unrestricted. */
  activeRuleName: string | null;
  /** Resolved primary tag key for the active event, even when browsing is unrestricted. */
  primaryTagKey: string | null;
  /** Human-friendly label for the resolved primary tag. */
  primaryTagLabel: string | null;
  /** Secondary tags inferred for the active event. */
  secondaryTagKeys: string[];
  /** Human-friendly labels for the inferred secondary tags. */
  secondaryTagLabels: string[];
  /** Resolved difficulty rank for the active event. */
  difficultyRank: DifficultyRank | null;
  /**
   * Effective allowed domains right now (intersection of bound-event profiles
   * + globalAllowlist). Empty = unrestricted (no binding found).
   */
  allowedDomains: string[];
  /** Recent unique event titles fetched from today's calendar, used by the Event Rules UI. */
  recentEventTitles: string[];
  /** Whether declarativeNetRequest rules should be active right now. */
  isRestricted: boolean;
  /** ISO string of last successful calendar API call. */
  lastSyncedAt: string | null;
  /** Non-null if the last sync failed (shown in popup as a warning). */
  authError: string | null;
}

// Full shape of chrome.storage.sync data
export interface StorageData {
  profiles: Profiles;
  globalAllowlist: string[];
  eventBindings: EventBindings;
  eventRules: EventRule[];
  keywordRules: KeywordRule[];
  eventLaunchTargets: EventLaunchTarget[];
  taskTags: TaskTag[];
  settings: Settings;
  taskQueue: Task[];
  snoozeState: SnoozeState;
  pointsHistory: PointsHistory;
  allTimeStats: AllTimeStats;
  calendarState: CalendarState;
  assistantOptions: AssistantOptions;
}

// Messages passed between service worker and UI pages
export type MessageType =
  | 'GET_STATE'
  | 'GET_BLOCKED_TAB_CONTEXT'
  | 'GET_CALENDAR_EVENTS_RANGE'
  | 'REFRESH_ACCOUNT_STATE'
  | 'REFRESH_ASSISTANT_STATE'
  | 'SIGN_IN_WITH_PROVIDER'
  | 'SIGN_OUT_ACCOUNT'
  | 'RESOLVE_ACCOUNT_CONFLICT'
  | 'TOGGLE_BLOCKING'
  | 'TOGGLE_PERSISTENT_PANEL'
  | 'CONNECT_CALENDAR'
  | 'DISCONNECT_CALENDAR'
  | 'SNOOZE'
  | 'SPEND_POINTS_UNLOCK'
  | 'SUBMIT_IDEA'
  | 'SUBMIT_ASSISTANT_TASK'
  | 'DECIDE_IDEA'
  | 'RETRY_IDEA'
  | 'START_OPENCLAW_SESSION'
  | 'REUSE_OPENCLAW_SESSION'
  | 'CANCEL_OPENCLAW_JOB'
  | 'CANCEL_ASSISTANT_TASK'
  | 'UPDATE_ASSISTANT_OPTIONS'
  | 'MARK_DONE'
  | 'DISMISS_TASK'
  | 'OPEN_ACTIVE_LAUNCH_TARGET'
  | 'SAVE_ANALYTICS_OVERRIDE'
  | 'REFRESH_ANALYTICS_STATE';

export interface Message {
  type: MessageType;
  payload?: unknown;
}

export interface StateResponse {
  settings: Settings;
  taskQueue: Task[];
  snoozeState: SnoozeState;
  allTimeStats: AllTimeStats;
  calendarState: CalendarState;
  eventRules: EventRule[];
  keywordRules: KeywordRule[];
  taskTags: TaskTag[];
  backendSession: BackendSession | null;
  accountUser: AccountUser | null;
  accountSyncState: AccountSyncState;
  accountConflict: AccountConflict | null;
  backendSyncState: BackendSyncState;
  assistantOptions: AssistantOptions;
  ideaState: IdeaState;
  openClawState: OpenClawState;
  analyticsSnapshot: AnalyticsSnapshot;
}
