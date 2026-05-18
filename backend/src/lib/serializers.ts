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
  LearningSubjectPayload,
  QuizAnswerResultPayload,
  QuizPackSummaryPayload,
  QuizPromptPayload,
  ReviewQueueItemPayload,
  OpenClawJobPayload,
  OpenClawSessionPayload,
  RemoteIdeaRecordPayload,
  UserLearningTopicPayload,
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
    extendedTaskSets: coerceExtendedTaskSets(snapshot.extendedTaskSets),
    extendedTaskAssignments: coerceExtendedTaskAssignments(snapshot.extendedTaskAssignments),
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

export function toLearningSubjectPayload(subject: {
  key: string;
  label: string;
  description: string;
  topics: Array<{
    key: string;
    label: string;
    description: string;
  }>;
}): LearningSubjectPayload {
  return {
    key: subject.key,
    label: subject.label,
    description: subject.description,
    topics: subject.topics.map((topic) => ({
      key: topic.key,
      label: topic.label,
      description: topic.description,
    })),
  };
}

export function toUserLearningTopicPayload(topic: {
  id: string;
  source: 'catalog' | 'custom' | 'suggested';
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  topic: {
    key: string;
    label: string;
    subject: {
      key: string;
    } | null;
  };
}): UserLearningTopicPayload {
  return {
    id: topic.id,
    subjectKey: topic.topic.subject?.key ?? null,
    topicKey: topic.topic.key,
    label: topic.topic.label,
    source: topic.source,
    active: topic.active,
    createdAt: topic.createdAt.toISOString(),
    updatedAt: topic.updatedAt.toISOString(),
  };
}

export function toQuizPackSummaryPayload(pack: {
  id: string;
  title: string;
  sourceKind: 'textbook' | 'paper_based';
  status: 'queued' | 'processing' | 'ready' | 'failed';
  canonical: boolean;
  createdAt: Date;
  topic: {
    id: string;
    label: string;
  };
  source?: {
    licenseMode: 'commercial_safe' | 'expanded_oer';
  } | null;
  versions: Array<{
    id: string;
    versionNumber: number;
    createdAt: Date;
    questions: Array<{ id: string; chapterId?: string | null }>;
  }>;
}): QuizPackSummaryPayload {
  const latestVersion = [...pack.versions].sort((left, right) => right.versionNumber - left.versionNumber)[0] ?? null;
  const chapterCount = latestVersion
    ? new Set(
        latestVersion.questions
          .map((question) => question.chapterId ?? null)
          .filter((chapterId): chapterId is string => typeof chapterId === 'string'),
      ).size
    : 0;
  return {
    id: pack.id,
    topicId: pack.topic.id,
    topicLabel: pack.topic.label,
    title: pack.title,
    sourceKind: pack.sourceKind === 'paper_based' ? 'paper-based' : 'textbook',
    status: pack.status,
    canonical: pack.canonical,
    chapterCount,
    questionCount: latestVersion?.questions.length ?? 0,
    versionNumber: latestVersion?.versionNumber ?? 1,
    licenseMode: pack.source?.licenseMode ?? 'commercial_safe',
    generatedAt: latestVersion?.createdAt.toISOString() ?? null,
  };
}

export function toReviewQueueItemPayload(item: {
  id: string;
  seenCount: number;
  correctStreak: number;
  dueAt: Date;
  lastSeenAt: Date | null;
  question: {
    id: string;
    difficulty: 'easy' | 'medium' | 'hard';
    chapter: {
      title: string;
    } | null;
    packVersion: {
      pack: {
        topic: {
          id: string;
          label: string;
        };
      };
    };
  };
}): ReviewQueueItemPayload {
  return {
    progressId: item.id,
    questionId: item.question.id,
    topicId: item.question.packVersion.pack.topic.id,
    topicLabel: item.question.packVersion.pack.topic.label,
    chapterTitle: item.question.chapter?.title ?? 'General review',
    difficulty: item.question.difficulty,
    dueAt: item.dueAt.toISOString(),
    lastSeenAt: item.lastSeenAt?.toISOString() ?? null,
    seenCount: item.seenCount,
    correctStreak: item.correctStreak,
  };
}

export function toQuizPromptPayload(question: {
  id: string;
  prompt: string;
  hint: string | null;
  explanation: string | null;
  correctChoiceId: string;
  choices: unknown;
  wrongAnswerExplanations: unknown;
  difficulty: 'easy' | 'medium' | 'hard';
  artifactType: 'image' | 'graph' | null;
  artifactData: unknown;
  chapter: {
    title: string;
  } | null;
  packVersion: {
    id: string;
    pack: {
      id: string;
      title: string;
      topic: {
        id: string;
        label: string;
      };
    };
  };
}, input: {
  sessionId: string;
  progressId: string | null;
  origin: 'scheduled' | 'manual' | 'retry';
  pointsReward: number;
  streak: number;
}): QuizPromptPayload {
  return {
    sessionId: input.sessionId,
    questionId: question.id,
    progressId: input.progressId,
    packId: question.packVersion.pack.id,
    packVersionId: question.packVersion.id,
    topicId: question.packVersion.pack.topic.id,
    topicLabel: question.packVersion.pack.topic.label,
    packTitle: question.packVersion.pack.title,
    chapterTitle: question.chapter?.title ?? 'General review',
    difficulty: question.difficulty,
    origin: input.origin,
    pointsReward: input.pointsReward,
    streak: input.streak,
    prompt: question.prompt,
    hint: question.hint,
    explanation: question.explanation,
    choices: Array.isArray(question.choices)
      ? question.choices.reduce<QuizPromptPayload['choices']>((acc, choice) => {
          if (!choice || typeof choice !== 'object') return acc;
          const id = typeof (choice as { id?: unknown }).id === 'string'
            ? (choice as { id: string }).id
            : null;
          const label = typeof (choice as { label?: unknown }).label === 'string'
            ? (choice as { label: string }).label
            : null;
          const body = typeof (choice as { body?: unknown }).body === 'string'
            ? (choice as { body: string }).body
            : '';
          if (!id || !label) return acc;
          acc.push({ id, label, body });
          return acc;
        }, [])
      : [],
    correctChoiceId: question.correctChoiceId,
    wrongAnswerExplanations: coerceStringRecord(question.wrongAnswerExplanations),
    artifact:
      question.artifactType === null
        ? null
        : {
            type: question.artifactType,
            alt: `${question.packVersion.pack.topic.label} study artifact`,
            imageUrl:
              question.artifactType === 'image' &&
              question.artifactData &&
              typeof question.artifactData === 'object' &&
              'imageUrl' in (question.artifactData as Record<string, unknown>) &&
              typeof (question.artifactData as Record<string, unknown>).imageUrl === 'string'
                ? ((question.artifactData as Record<string, unknown>).imageUrl as string)
                : null,
            graphSpec:
              question.artifactType === 'graph' &&
              question.artifactData &&
              typeof question.artifactData === 'object'
                ? (question.artifactData as Record<string, unknown>)
                : null,
          },
    surfacedAt: new Date().toISOString(),
  };
}

export function toQuizAnswerResultPayload(input: {
  prompt: QuizPromptPayload;
  correct: boolean;
  selectedChoiceId: string | null;
  explanation: string | null;
  wrongAnswerExplanation: string | null;
  nextDueAt: Date | null;
  pointsAwarded: number;
  updatedStreak: number;
}): QuizAnswerResultPayload {
  return {
    prompt: input.prompt,
    correct: input.correct,
    selectedChoiceId: input.selectedChoiceId,
    correctChoiceId: input.prompt.correctChoiceId,
    explanation: input.explanation,
    wrongAnswerExplanation: input.wrongAnswerExplanation,
    nextDueAt: input.nextDueAt?.toISOString() ?? null,
    pointsAwarded: input.pointsAwarded,
    updatedStreak: input.updatedStreak,
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

function coerceExtendedTaskSets(value: unknown): AccountSnapshotPayload['extendedTaskSets'] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (item): item is {
        id?: unknown;
        title?: unknown;
        items?: unknown;
        createdAt?: unknown;
        updatedAt?: unknown;
        archivedAt?: unknown;
      } => Boolean(item && typeof item === 'object'),
    )
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id : '',
      title: typeof item.title === 'string' ? item.title : '',
      items: coerceExtendedTaskSetItems(item.items),
      createdAt:
        typeof item.createdAt === 'string'
          ? item.createdAt
          : new Date(0).toISOString(),
      updatedAt:
        typeof item.updatedAt === 'string'
          ? item.updatedAt
          : new Date(0).toISOString(),
      archivedAt: typeof item.archivedAt === 'string' ? item.archivedAt : null,
    }))
    .filter((item) => item.id.length > 0 && item.title.length > 0);
}

function coerceExtendedTaskSetItems(
  value: unknown,
): AccountSnapshotPayload['extendedTaskSets'][number]['items'] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (item): item is { id?: unknown; label?: unknown; url?: unknown } =>
        Boolean(item && typeof item === 'object'),
    )
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id : '',
      label: typeof item.label === 'string' ? item.label : '',
      url: typeof item.url === 'string' ? item.url : '',
    }))
    .filter((item) => item.id.length > 0 && item.label.length > 0 && item.url.length > 0);
}

function coerceExtendedTaskAssignments(
  value: unknown,
): AccountSnapshotPayload['extendedTaskAssignments'] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (item): item is {
        id?: unknown;
        calendarEventId?: unknown;
        eventTitle?: unknown;
        start?: unknown;
        end?: unknown;
        setId?: unknown;
        setTitle?: unknown;
        items?: unknown;
        createdAt?: unknown;
        updatedAt?: unknown;
      } => Boolean(item && typeof item === 'object'),
    )
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id : '',
      calendarEventId: typeof item.calendarEventId === 'string' ? item.calendarEventId : '',
      eventTitle: typeof item.eventTitle === 'string' ? item.eventTitle : '',
      start: typeof item.start === 'string' ? item.start : '',
      end: typeof item.end === 'string' ? item.end : '',
      setId: typeof item.setId === 'string' ? item.setId : '',
      setTitle: typeof item.setTitle === 'string' ? item.setTitle : '',
      items: coerceExtendedTaskAssignmentItems(item.items),
      createdAt:
        typeof item.createdAt === 'string'
          ? item.createdAt
          : new Date(0).toISOString(),
      updatedAt:
        typeof item.updatedAt === 'string'
          ? item.updatedAt
          : new Date(0).toISOString(),
    }))
    .filter((item) => item.id.length > 0 && item.calendarEventId.length > 0);
}

function coerceExtendedTaskAssignmentItems(
  value: unknown,
): AccountSnapshotPayload['extendedTaskAssignments'][number]['items'] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (item): item is { id?: unknown; label?: unknown; url?: unknown; completedAt?: unknown } =>
        Boolean(item && typeof item === 'object'),
    )
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id : '',
      label: typeof item.label === 'string' ? item.label : '',
      url: typeof item.url === 'string' ? item.url : '',
      completedAt: typeof item.completedAt === 'string' ? item.completedAt : null,
    }))
    .filter((item) => item.id.length > 0 && item.label.length > 0 && item.url.length > 0);
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
