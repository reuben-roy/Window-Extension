import type {
  InterestProfile,
  OpenClawSession,
  Prisma,
  Recommendation,
  ResearchJob,
} from '@prisma/client';
import type {
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

