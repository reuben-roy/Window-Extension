import type {
  AssistantTaskResult,
  InterestProfile,
  OpenClawConnection,
  OpenClawSession,
  Prisma,
  Recommendation,
  ResearchJob,
} from '@prisma/client';
import type {
  AccountSnapshotPayload,
  AccountUserPayload,
  AssistantConnectorPayload,
  AssistantTaskPayload,
  FocusSessionPayload,
  IdeaReportPayload,
  OpenClawJobPayload,
  OpenClawSessionPayload,
  RemoteIdeaRecordPayload,
} from '../types.js';

export type IdeaWithRelations = Prisma.IdeaCaptureGetPayload<{
  include: {
    report: true;
    researchJob: true;
    session: true;
  };
}>;

export type AssistantTaskWithRelations = Prisma.AssistantTaskGetPayload<{
  include: {
    job: true;
    result: true;
    session: true;
  };
}>;

export function toAccountUserPayload(user: {
  id: string;
  email: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  createdAt: Date;
  providers?: AccountUserPayload['providers'];
}): AccountUserPayload {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName ?? null,
    avatarUrl: user.avatarUrl ?? null,
    providers: [...new Set(user.providers ?? [])],
    createdAt: user.createdAt.toISOString(),
  };
}

export function toAccountSnapshotPayload(value: unknown): AccountSnapshotPayload {
  const snapshot = (value ?? {}) as Partial<AccountSnapshotPayload>;
  const allTimeStats = (snapshot.allTimeStats ?? {}) as Partial<AccountSnapshotPayload['allTimeStats']>;

  return {
    allTimeStats: {
      totalPoints: coerceNumber(allTimeStats.totalPoints),
      level: coerceNumber(allTimeStats.level, 1),
      title: typeof allTimeStats.title === 'string' ? allTimeStats.title : 'Novice',
      prestigeCount: coerceNumber(allTimeStats.prestigeCount),
      tasksCompleted: coerceNumber(allTimeStats.tasksCompleted),
      bestWeek: coerceNumber(allTimeStats.bestWeek),
      currentWeekStreak: coerceNumber(allTimeStats.currentWeekStreak),
    },
    pointsHistory: coercePointsHistory(snapshot.pointsHistory),
    profiles: coerceProfiles(snapshot.profiles),
    eventBindings: coerceStringRecord(snapshot.eventBindings),
    eventRules: coerceEventRules(snapshot.eventRules),
    keywordRules: coerceKeywordRules(snapshot.keywordRules),
    taskTags: coerceTaskTags(snapshot.taskTags),
    globalAllowlist: coerceStringArray(snapshot.globalAllowlist),
  };
}

export function toIdeaRecordPayload(idea: IdeaWithRelations): RemoteIdeaRecordPayload {
  return {
    id: idea.id,
    clientLocalId: idea.clientLocalId,
    prompt: idea.prompt,
    status: idea.status,
    createdAt: idea.createdAt.toISOString(),
    updatedAt: idea.updatedAt.toISOString(),
    saved: idea.saved,
    archived: idea.archived,
    error: idea.lastError ?? null,
    sessionId: idea.sessionId,
    jobId: idea.researchJob?.id ?? null,
    report: toIdeaReportPayload(idea.report),
  };
}

export function toIdeaReportPayload(report: {
  summary: string;
  viability: string;
  competitionSnapshot: string;
  buildEffort: string;
  revenuePotential: string;
  risks: unknown;
  nextSteps: unknown;
  sourceLinks: unknown;
  completedAt: Date;
} | null): IdeaReportPayload | null {
  if (!report) return null;

  return {
    summary: report.summary,
    viability: normalizeViability(report.viability),
    competitionSnapshot: report.competitionSnapshot,
    buildEffort: report.buildEffort,
    revenuePotential: report.revenuePotential,
    risks: coerceStringArray(report.risks),
    nextSteps: coerceStringArray(report.nextSteps),
    sourceLinks: coerceStringArray(report.sourceLinks),
    completedAt: report.completedAt.toISOString(),
  };
}

export function toOpenClawSessionPayload(session: OpenClawSession): OpenClawSessionPayload {
  return {
    id: session.id,
    title: session.title,
    status: session.status,
    modelLabel: session.modelLabel,
    startedAt: session.startedAt.toISOString(),
    lastActivityAt: session.lastActivityAt.toISOString(),
  };
}

export function toOpenClawJobPayload(job: ResearchJob): OpenClawJobPayload {
  return {
    id: job.id,
    ideaId: job.ideaId,
    title: job.title,
    status: job.status,
    startedAt: job.startedAt?.toISOString() ?? null,
    updatedAt: job.updatedAt.toISOString(),
  };
}

export function toAssistantConnectorPayload(
  connector: OpenClawConnection,
): AssistantConnectorPayload {
  return {
    id: connector.id,
    key: connector.key,
    label: connector.name,
    connectorType: 'openclaw',
    transport:
      connector.transport === 'ssh' || connector.transport === 'http'
        ? connector.transport
        : 'unknown',
    enabled: connector.enabled,
    host: connector.host,
    baseUrl: connector.baseUrl,
    description: connector.description ?? null,
  };
}

export function toAssistantTaskPayload(
  task: AssistantTaskWithRelations,
): AssistantTaskPayload {
  return {
    id: task.id,
    connectorId: task.connectorId,
    title: task.title,
    prompt: task.prompt,
    status: task.status,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    completedAt: task.completedAt?.toISOString() ?? null,
    error: task.lastError ?? task.job?.lastError ?? null,
    sessionId: task.sessionId,
    jobId: task.job?.id ?? null,
    notificationMode: task.notificationMode,
    focusContextType: task.focusContextType,
    focusContextId: task.focusContextId,
    notifiedAt: task.notifiedAt?.toISOString() ?? null,
    result: toAssistantTaskResultPayload(task.result),
  };
}

export function toAssistantTaskResultPayload(
  result: AssistantTaskResult | null,
): AssistantTaskPayload['result'] {
  if (!result) return null;

  return {
    summary: result.summary,
    output: result.output,
    completedAt: result.completedAt.toISOString(),
  };
}

export function toInterestPayload(profile: InterestProfile): {
  id: string;
  key: string;
  label: string;
  proficiency: number;
  minutes: number;
  updatedAt: string;
} {
  return {
    id: profile.id,
    key: profile.key,
    label: profile.label,
    proficiency: profile.proficiency,
    minutes: profile.minutes,
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export function toRecommendationPayload(recommendation: Recommendation): {
  id: string;
  kind: Recommendation['kind'];
  title: string;
  body: string;
  createdAt: string;
} {
  return {
    id: recommendation.id,
    kind: recommendation.kind,
    title: recommendation.title,
    body: recommendation.body,
    createdAt: recommendation.createdAt.toISOString(),
  };
}

export function toFocusSessionPayload(session: {
  id: string;
  clientSessionId?: string;
  calendarEventId: string;
  eventTitle: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  startedAt: Date;
  endedAt: Date;
  sourceRuleType: string;
  sourceRuleName: string | null;
  tagKey: string | null;
  secondaryTagKeys: unknown;
  difficultyRank: number | null;
  productiveMinutes: number;
  supportiveMinutes: number;
  distractedMinutes: number;
  awayMinutes: number;
  breakMinutes: number;
  totalTrackedMinutes: number;
  leftEarly: boolean;
}): FocusSessionPayload {
  return {
    id: session.clientSessionId ?? session.id,
    calendarEventId: session.calendarEventId,
    eventTitle: session.eventTitle,
    scheduledStart: session.scheduledStart.toISOString(),
    scheduledEnd: session.scheduledEnd.toISOString(),
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt.toISOString(),
    sourceRuleType:
      session.sourceRuleType === 'event' || session.sourceRuleType === 'keyword'
        ? session.sourceRuleType
        : 'none',
    sourceRuleName: session.sourceRuleName,
    tagKey: session.tagKey,
    secondaryTagKeys: coerceStringArray(session.secondaryTagKeys),
    difficultyRank: normalizeDifficulty(session.difficultyRank),
    productiveMinutes: session.productiveMinutes,
    supportiveMinutes: session.supportiveMinutes,
    distractedMinutes: session.distractedMinutes,
    awayMinutes: session.awayMinutes,
    breakMinutes: session.breakMinutes,
    totalTrackedMinutes: session.totalTrackedMinutes,
    leftEarly: session.leftEarly,
  };
}

function normalizeViability(value: string): IdeaReportPayload['viability'] {
  if (value === 'low' || value === 'moderate' || value === 'high') {
    return value;
  }

  return 'unknown';
}

function coerceStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }

  return [];
}

function coerceNumber(value: unknown, fallback: number = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function coerceStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.entries(value).reduce<Record<string, string>>((acc, [key, item]) => {
    if (typeof item === 'string') {
      acc[key] = item;
    }
    return acc;
  }, {});
}

function coerceProfiles(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.entries(value).reduce<Record<string, string[]>>((acc, [key, item]) => {
    acc[key] = coerceStringArray(item);
    return acc;
  }, {});
}

function coerceEventRules(value: unknown): AccountSnapshotPayload['eventRules'] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (item): item is {
        eventTitle?: unknown;
        domains?: unknown;
        tagKey?: unknown;
        secondaryTagKeys?: unknown;
        difficultyOverride?: unknown;
      } => Boolean(item && typeof item === 'object'),
    )
    .map((item) => ({
      eventTitle: typeof item.eventTitle === 'string' ? item.eventTitle : '',
      domains: coerceStringArray(item.domains),
      tagKey: typeof item.tagKey === 'string' ? item.tagKey : null,
      secondaryTagKeys: coerceStringArray(item.secondaryTagKeys),
      difficultyOverride: normalizeDifficulty(item.difficultyOverride),
    }))
    .filter((item) => item.eventTitle.length > 0);
}

function coerceKeywordRules(value: unknown): AccountSnapshotPayload['keywordRules'] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (item): item is { keyword?: unknown; domains?: unknown; createdAt?: unknown; tagKey?: unknown } =>
        Boolean(item && typeof item === 'object'),
    )
    .map((item) => ({
      keyword: typeof item.keyword === 'string' ? item.keyword : '',
      domains: coerceStringArray(item.domains),
      createdAt:
        typeof item.createdAt === 'string'
          ? item.createdAt
          : new Date(0).toISOString(),
      tagKey: typeof item.tagKey === 'string' ? item.tagKey : null,
    }))
    .filter((item) => item.keyword.length > 0);
}

function coerceTaskTags(value: unknown): AccountSnapshotPayload['taskTags'] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (item): item is {
        key?: unknown;
        label?: unknown;
        color?: unknown;
        aliases?: unknown;
        baselineDifficulty?: unknown;
        alignedDomains?: unknown;
        supportiveDomains?: unknown;
        source?: unknown;
        archivedAt?: unknown;
        updatedAt?: unknown;
      } => Boolean(item && typeof item === 'object'),
    )
    .map((item) => ({
      key: typeof item.key === 'string' ? item.key : '',
      label: typeof item.label === 'string' ? item.label : '',
      color: typeof item.color === 'string' ? item.color : '#64748b',
      aliases: coerceStringArray(item.aliases),
      baselineDifficulty: normalizeDifficulty(item.baselineDifficulty) ?? 3,
      alignedDomains: coerceStringArray(item.alignedDomains),
      supportiveDomains: coerceStringArray(item.supportiveDomains),
      source: (
        item.source === 'keyword' || item.source === 'auto' || item.source === 'user'
          ? item.source
          : 'seed'
      ) as AccountSnapshotPayload['taskTags'][number]['source'],
      archivedAt: typeof item.archivedAt === 'string' ? item.archivedAt : null,
      updatedAt:
        typeof item.updatedAt === 'string'
          ? item.updatedAt
          : new Date(0).toISOString(),
    }))
    .filter((item) => item.key.length > 0);
}

function coercePointsHistory(value: unknown): AccountSnapshotPayload['pointsHistory'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.entries(value).reduce<AccountSnapshotPayload['pointsHistory']>((acc, [key, item]) => {
    const week = (item ?? {}) as Partial<AccountSnapshotPayload['pointsHistory'][string]>;
    acc[key] = {
      earned: coerceNumber(week.earned),
      tasksCompleted: coerceNumber(week.tasksCompleted),
      tasksDismissed: coerceNumber(week.tasksDismissed),
      tasksExpired: coerceNumber(week.tasksExpired),
      snoozesUsed: coerceNumber(week.snoozesUsed),
      perfectDays: coerceNumber(week.perfectDays),
      longestStreak: coerceNumber(week.longestStreak),
    };
    return acc;
  }, {});
}

function normalizeDifficulty(value: unknown): 1 | 2 | 3 | 5 | 8 | null {
  if (value === 1 || value === 2 || value === 3 || value === 5 || value === 8) {
    return value;
  }

  return null;
}
