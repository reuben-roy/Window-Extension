export type IdeaStatus =
  | 'queued'
  | 'syncing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'kept'
  | 'discarded';

export type AuthProvider = 'google' | 'github' | 'password';
export type OpenClawSessionStatus = 'active' | 'idle' | 'closed';
export type OpenClawJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AssistantConnectorType = 'openclaw';
export type AssistantTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type TaskNotificationMode = 'immediate' | 'after_focus' | 'inbox_only';
export type AssistantFocusContextType = 'none' | 'window_task' | 'calendar_event';

export interface WeeklyStatsPayload {
  earned: number;
  tasksCompleted: number;
  tasksDismissed: number;
  tasksExpired: number;
  snoozesUsed: number;
  perfectDays: number;
  longestStreak: number;
}

export interface AllTimeStatsPayload {
  totalPoints: number;
  level: number;
  title: string;
  prestigeCount: number;
  tasksCompleted: number;
  bestWeek: number;
  currentWeekStreak: number;
}

export interface KeywordRulePayload {
  keyword: string;
  domains: string[];
  createdAt: string;
  tagKey: string | null;
}

export interface TaskTagPayload {
  key: string;
  label: string;
  color: string;
  aliases: string[];
  baselineDifficulty: 1 | 2 | 3 | 5 | 8;
  alignedDomains: string[];
  supportiveDomains: string[];
  source: 'seed' | 'keyword' | 'auto' | 'user';
  updatedAt: string;
}

export interface EventRulePayload {
  eventTitle: string;
  domains: string[];
  tagKey: string | null;
  difficultyOverride: 1 | 2 | 3 | 5 | 8 | null;
}

export interface AccountSnapshotPayload {
  allTimeStats: AllTimeStatsPayload;
  pointsHistory: Record<string, WeeklyStatsPayload>;
  profiles: Record<string, string[]>;
  eventBindings: Record<string, string>;
  eventRules: EventRulePayload[];
  keywordRules: KeywordRulePayload[];
  taskTags: TaskTagPayload[];
  globalAllowlist: string[];
}

export interface AccountUserPayload {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  providers: AuthProvider[];
  createdAt: string;
}

export interface AuthSessionPayload {
  sessionToken: string;
  userId: string;
  expiresAt: string;
  user: AccountUserPayload;
}

export interface AccountSnapshotResponsePayload {
  revision: number;
  updatedAt: string | null;
  data: AccountSnapshotPayload;
}

export interface IdeaReportPayload {
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

export interface RemoteIdeaRecordPayload {
  id: string;
  clientLocalId: string;
  prompt: string;
  status: IdeaStatus;
  createdAt: string;
  updatedAt: string;
  saved: boolean;
  archived: boolean;
  error: string | null;
  sessionId: string | null;
  jobId: string | null;
  report: IdeaReportPayload | null;
}

export interface OpenClawSessionPayload {
  id: string;
  title: string;
  status: OpenClawSessionStatus;
  modelLabel: string | null;
  startedAt: string;
  lastActivityAt: string;
}

export interface OpenClawJobPayload {
  id: string;
  ideaId: string | null;
  title: string;
  status: OpenClawJobStatus;
  startedAt: string | null;
  updatedAt: string;
}

export interface OpenClawStatusPayload {
  status: {
    connected: boolean;
    healthy: boolean;
    transport: 'ssh' | 'http' | 'unknown';
    label: string | null;
    message: string | null;
    lastCheckedAt: string | null;
  };
  currentJob: OpenClawJobPayload | null;
}

export interface AssistantConnectorPayload {
  id: string;
  key: string;
  label: string;
  connectorType: AssistantConnectorType;
  transport: 'ssh' | 'http' | 'unknown';
  enabled: boolean;
  host: string | null;
  baseUrl: string | null;
  description: string | null;
}

export interface AssistantTaskResultPayload {
  summary: string;
  output: string;
  completedAt: string;
}

export interface AssistantTaskPayload {
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
  notificationMode: TaskNotificationMode;
  focusContextType: AssistantFocusContextType;
  focusContextId: string | null;
  notifiedAt: string | null;
  result: AssistantTaskResultPayload | null;
}

export interface OpenClawCreateSessionInput {
  title: string;
  preferredModel?: string;
}

export interface OpenClawIdeaJobInput {
  prompt: string;
  preferredModel?: string;
  notes?: string;
  sessionId?: string | null;
}

export interface OpenClawJobResult {
  status: OpenClawJobStatus;
  report: IdeaReportPayload | null;
  error: string | null;
}

export interface AssistantTaskCreateInput {
  prompt: string;
  title?: string;
  preferredModel?: string;
  notes?: string;
  notificationMode?: TaskNotificationMode;
  focusContextType?: AssistantFocusContextType;
  focusContextId?: string | null;
  autoCreateSession?: boolean;
  reuseActiveSession?: boolean;
}

export interface AnalyticsSummaryPayload {
  range: '7d' | '30d';
  productiveMinutes: number;
  supportiveMinutes: number;
  distractedMinutes: number;
  awayMinutes: number;
  breakMinutes: number;
  totalFocusSessions: number;
  leftEarlyCount: number;
}

export interface TagBreakdownPayload {
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

export interface FocusSessionPayload {
  id: string;
  calendarEventId: string;
  eventTitle: string;
  scheduledStart: string;
  scheduledEnd: string;
  startedAt: string;
  endedAt: string;
  sourceRuleType: 'event' | 'keyword' | 'none';
  sourceRuleName: string | null;
  tagKey: string | null;
  difficultyRank: 1 | 2 | 3 | 5 | 8 | null;
  productiveMinutes: number;
  supportiveMinutes: number;
  distractedMinutes: number;
  awayMinutes: number;
  breakMinutes: number;
  totalTrackedMinutes: number;
  leftEarly: boolean;
}
