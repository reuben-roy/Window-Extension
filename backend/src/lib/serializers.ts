import type {
  InterestProfile,
  OpenClawSession,
  Prisma,
  Recommendation,
  ResearchJob,
} from '@prisma/client';
import type {
  AccountSnapshotPayload,
  AccountUserPayload,
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
    .filter((item): item is { eventTitle?: unknown; domains?: unknown } => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      eventTitle: typeof item.eventTitle === 'string' ? item.eventTitle : '',
      domains: coerceStringArray(item.domains),
    }))
    .filter((item) => item.eventTitle.length > 0);
}

function coerceKeywordRules(value: unknown): AccountSnapshotPayload['keywordRules'] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (item): item is { keyword?: unknown; domains?: unknown; createdAt?: unknown } =>
        Boolean(item && typeof item === 'object'),
    )
    .map((item) => ({
      keyword: typeof item.keyword === 'string' ? item.keyword : '',
      domains: coerceStringArray(item.domains),
      createdAt:
        typeof item.createdAt === 'string'
          ? item.createdAt
          : new Date(0).toISOString(),
    }))
    .filter((item) => item.keyword.length > 0);
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
