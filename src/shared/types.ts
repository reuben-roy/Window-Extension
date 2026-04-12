// Task lifecycle statuses
export type TaskStatus = 'active' | 'carryover' | 'completed' | 'dismissed' | 'expired';

// Carryover stacking mode
export type CarryoverMode = 'union' | 'intersection';

export type BreakDurationMinutes = 5 | 10 | 15;
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
export type RecommendationKind = 'focus' | 'calendar' | 'interest' | 'automation';

export interface EventRule {
  eventTitle: string;
  domains: string[];
}

export interface KeywordRule {
  keyword: string;
  domains: string[];
  createdAt: string;
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

export interface BackendSession {
  sessionToken: string;
  userId: string;
  expiresAt: string;
  connectedAt: string;
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

export interface OpenClawState {
  status: OpenClawConnectionStatus;
  sessions: OpenClawSessionSummary[];
  activeSessionId: string | null;
  currentJob: OpenClawJobSummary | null;
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

export interface UnlockSpendState {
  activeEventKey: string | null;
  spendCount: number;
}

// Google Calendar event (normalized from API response)
export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // ISO string
  end: string;   // ISO string
  isAllDay: boolean;
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
  | 'REFRESH_ASSISTANT_STATE'
  | 'TOGGLE_BLOCKING'
  | 'TOGGLE_PERSISTENT_PANEL'
  | 'CONNECT_CALENDAR'
  | 'DISCONNECT_CALENDAR'
  | 'SNOOZE'
  | 'SPEND_POINTS_UNLOCK'
  | 'SUBMIT_IDEA'
  | 'DECIDE_IDEA'
  | 'RETRY_IDEA'
  | 'START_OPENCLAW_SESSION'
  | 'REUSE_OPENCLAW_SESSION'
  | 'CANCEL_OPENCLAW_JOB'
  | 'UPDATE_ASSISTANT_OPTIONS'
  | 'MARK_DONE'
  | 'DISMISS_TASK';

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
  backendSession: BackendSession | null;
  backendSyncState: BackendSyncState;
  assistantOptions: AssistantOptions;
  ideaState: IdeaState;
  openClawState: OpenClawState;
}
