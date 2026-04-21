import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { env } from './env.js';
import { prisma } from './lib/prisma.js';
import {
  fetchGoogleUserProfile,
  issueBackendSession,
  requireUser,
  revokeBackendSession,
  verifyGoogleAccessToken,
} from './lib/auth.js';
import { openClawConnector } from './lib/openclaw/client.js';
import {
  toAccountSnapshotPayload,
  toAccountUserPayload,
  toAssistantConnectorPayload,
  toAssistantTaskPayload,
  toFocusSessionPayload,
  toIdeaRecordPayload,
  toInterestPayload,
  toOpenClawJobPayload,
  toOpenClawSessionPayload,
  toRecommendationPayload,
} from './lib/serializers.js';
import type {
  AccountSnapshotPayload,
  AccountSnapshotResponsePayload,
  AccountUserPayload,
} from './types.js';

const googleExchangeSchema = z.object({
  googleAccessToken: z.string().min(1),
});

const createSessionSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  preferredModel: z.string().max(160).optional(),
  reuseSessionId: z.string().min(1).optional(),
});

const createIdeaSchema = z.object({
  clientLocalId: z.string().min(1),
  prompt: z.string().min(1).max(8_000),
  preferredModel: z.string().max(160).optional(),
  autoCreateSession: z.boolean().optional().default(true),
  reuseActiveSession: z.boolean().optional().default(true),
  notes: z.string().max(2_000).optional(),
});

const selectConnectorSchema = z.object({
  connectorId: z.string().min(1),
});

const createAssistantTaskSchema = z.object({
  prompt: z.string().min(1).max(8_000),
  title: z.string().min(1).max(160).optional(),
  preferredModel: z.string().max(160).optional(),
  autoCreateSession: z.boolean().optional().default(true),
  reuseActiveSession: z.boolean().optional().default(true),
  notes: z.string().max(2_000).optional(),
  notificationMode: z.enum(['immediate', 'after_focus', 'inbox_only']).optional().default('after_focus'),
  focusContextType: z.enum(['none', 'window_task', 'calendar_event']).optional().default('none'),
  focusContextId: z.string().nullable().optional(),
});

const ideaDecisionSchema = z.object({
  decision: z.enum(['keep', 'discard']),
});

const breakVisitsSchema = z.object({
  events: z.array(
    z.object({
      id: z.string().min(1),
      tabId: z.number().int(),
      domain: z.string().min(1),
      startedAt: z.string().datetime(),
      endedAt: z.string().datetime(),
      activeEventTitle: z.string().nullable(),
    }),
  ),
});

const accountSnapshotPutSchema = z.object({
  revision: z.number().int().min(0),
  data: z.unknown(),
});

const difficultyRankSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(5),
  z.literal(8),
]);

const activitySessionsBatchSchema = z.object({
  focusSessions: z.array(
    z.object({
      id: z.string().min(1),
      calendarEventId: z.string().min(1),
      eventTitle: z.string().min(1),
      scheduledStart: z.string().datetime(),
      scheduledEnd: z.string().datetime(),
      startedAt: z.string().datetime(),
      endedAt: z.string().datetime(),
      sourceRuleType: z.enum(['event', 'keyword', 'none']),
      sourceRuleName: z.string().nullable(),
      tagKey: z.string().nullable(),
      difficultyRank: difficultyRankSchema.nullable(),
      productiveMinutes: z.number().int().min(0),
      supportiveMinutes: z.number().int().min(0),
      distractedMinutes: z.number().int().min(0),
      awayMinutes: z.number().int().min(0),
      breakMinutes: z.number().int().min(0),
      totalTrackedMinutes: z.number().int().min(0),
      leftEarly: z.boolean(),
    }),
  ),
  activitySessions: z.array(
    z.object({
      id: z.string().min(1),
      focusSessionId: z.string().min(1),
      calendarEventId: z.string().min(1),
      eventTitle: z.string().min(1),
      domain: z.string().nullable(),
      startedAt: z.string().datetime(),
      endedAt: z.string().datetime(),
      activityClass: z.enum(['aligned', 'supportive', 'distracted', 'away', 'break']),
      tagKey: z.string().nullable(),
      difficultyRank: difficultyRankSchema.nullable(),
      sourceRuleType: z.enum(['event', 'keyword', 'none']),
      sourceRuleName: z.string().nullable(),
    }),
  ),
});

const analyticsOverrideSchema = z.object({
  focusSessionId: z.string().min(1),
  tagKey: z.string().nullable(),
  difficultyRank: difficultyRankSchema.nullable(),
});

const analyticsRangeSchema = z.enum(['7d', '30d']);

const emptyAccountSnapshot = (): AccountSnapshotPayload => ({
  allTimeStats: {
    totalPoints: 0,
    level: 1,
    title: 'Novice',
    prestigeCount: 0,
    tasksCompleted: 0,
    bestWeek: 0,
    currentWeekStreak: 0,
  },
  pointsHistory: {},
  profiles: {},
  eventBindings: {},
  eventRules: [],
  keywordRules: [],
  taskTags: [],
  globalAllowlist: ['accounts.google.com'],
});

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  app.addHook('onRequest', async (request, reply) => {
    applyCors(reply);
    if (request.method === 'OPTIONS') {
      reply.code(204).send();
    }
  });

  app.get('/healthz', async () => ({
    ok: true,
    service: 'window-backend',
  }));

  app.post('/v1/auth/google/exchange', async (request) => {
    const body = googleExchangeSchema.parse(request.body);
    const [profile, googleUserProfile] = await Promise.all([
      verifyGoogleAccessToken(
        env.GOOGLE_TOKENINFO_URL,
        body.googleAccessToken,
      ),
      fetchGoogleUserProfile(body.googleAccessToken).catch(() => ({})),
    ]);
    const user = await upsertGoogleUser({
      ...profile,
      ...googleUserProfile,
    });
    return issueSessionPayload(user.id, {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
      providers: ['google'],
    });
  });

  app.post('/v1/auth/logout', async (request, reply) => {
    const sessionToken = getSessionTokenFromHeader(request);
    if (!sessionToken) {
      return reply.code(204).send();
    }

    await revokeBackendSession(sessionToken);
    return reply.code(204).send();
  });

  app.get('/v1/auth/me', async (request, reply) => {
    const user = await getUserOrReply(request, reply);
    if (!user) return;

    const fullUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: {
        identities: {
          select: {
            provider: true,
          },
        },
      },
    });

    return {
      user: toAccountUserPayload({
        id: fullUser.id,
        email: fullUser.email,
        displayName: fullUser.displayName,
        avatarUrl: fullUser.avatarUrl,
        createdAt: fullUser.createdAt,
        providers: fullUser.identities.map((identity) => identity.provider),
      }),
    };
  });

  app.get('/v1/account/snapshot', async (request, reply) => {
    const user = await getUserOrReply(request, reply);
    if (!user) return;

    return getAccountSnapshotResponse(user.id);
  });

  app.put('/v1/account/snapshot', async (request, reply) => {
    const user = await getUserOrReply(request, reply);
    if (!user) return;

    const body = accountSnapshotPutSchema.parse(request.body);
    const nextData = toAccountSnapshotPayload(body.data);
    const existing = await prisma.userSyncState.findUnique({
      where: { userId: user.id },
    });

    if (!existing) {
      if (body.revision !== 0) {
        return reply.code(409).send({
          error: 'Snapshot revision conflict.',
          snapshot: await getAccountSnapshotResponse(user.id),
        });
      }

      const created = await prisma.userSyncState.create({
        data: {
          userId: user.id,
          revision: 1,
          snapshot: nextData as unknown as Prisma.InputJsonValue,
        },
      });
      await syncTaskTagsFromSnapshot(user.id, nextData);

      return {
        revision: created.revision,
        updatedAt: created.updatedAt.toISOString(),
        data: toAccountSnapshotPayload(created.snapshot),
      } satisfies AccountSnapshotResponsePayload;
    }

    if (body.revision !== existing.revision) {
      return reply.code(409).send({
        error: 'Snapshot revision conflict.',
        snapshot: {
          revision: existing.revision,
          updatedAt: existing.updatedAt.toISOString(),
          data: toAccountSnapshotPayload(existing.snapshot),
        } satisfies AccountSnapshotResponsePayload,
      });
    }

    const updated = await prisma.userSyncState.update({
      where: { userId: user.id },
        data: {
          revision: existing.revision + 1,
          snapshot: nextData as unknown as Prisma.InputJsonValue,
        },
      });
    await syncTaskTagsFromSnapshot(user.id, nextData);

    return {
      revision: updated.revision,
      updatedAt: updated.updatedAt.toISOString(),
      data: toAccountSnapshotPayload(updated.snapshot),
    } satisfies AccountSnapshotResponsePayload;
  });

  app.get('/v1/connectors', async (request, reply) => {
    const user = await getUserOrReply(request, reply);
    if (!user) return;

    await openClawConnector.syncConnectionRecord();

    const [connectors, selectedConnector] = await Promise.all([
      prisma.openClawConnection.findMany({
        where: { enabled: true },
        orderBy: { createdAt: 'asc' },
      }),
      resolveSelectedConnector(user.id),
    ]);

    return {
      connectors: connectors.map(toAssistantConnectorPayload),
      selectedConnectorId: selectedConnector?.id ?? null,
    };
  });

  app.post('/v1/connectors/select', async (request, reply) => {
    const user = await getUserOrReply(request, reply);
    if (!user) return;

    const body = selectConnectorSchema.parse(request.body ?? {});
    await openClawConnector.syncConnectionRecord();
    const connector = await prisma.openClawConnection.findFirst({
      where: {
        id: body.connectorId,
        enabled: true,
      },
    });

    if (!connector) {
      return reply.code(404).send({ error: 'Connector not found.' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        selectedConnectorId: connector.id,
      },
    });

    return {
      selectedConnectorId: connector.id,
      connector: toAssistantConnectorPayload(connector),
    };
  });

  app.get('/v1/openclaw/status', async (request, reply) => {
    const user = await getUserOrReply(request, reply);
    if (!user) return;

    const connector = await resolveSelectedConnector(user.id);
    if (!connector) {
      return {
        status: {
          connected: false,
          healthy: false,
          transport: 'unknown',
          label: 'OpenClaw',
          message: 'No connector is configured.',
          lastCheckedAt: new Date().toISOString(),
        },
        currentJob: null,
      };
    }

    const [status, currentJob] = await Promise.all([
      openClawConnector.getStatus(connector),
      prisma.researchJob.findFirst({
        where: {
          idea: {
            userId: user.id,
            session: {
              connectorId: connector.id,
            },
          },
          status: {
            in: ['queued', 'running'],
          },
        },
        orderBy: [
          { status: 'asc' },
          { updatedAt: 'desc' },
        ],
      }),
    ]);

    return {
      status,
      currentJob: currentJob ? toOpenClawJobPayload(currentJob) : null,
    };
  });

  app.get('/v1/openclaw/sessions', async (request, reply) => {
    const user = await getUserOrReply(request, reply);
    if (!user) return;

    const connector = await resolveSelectedConnector(user.id);
    const sessions = await prisma.openClawSession.findMany({
      where: connector
        ? {
            userId: user.id,
            OR: [{ connectorId: connector.id }, { connectorId: null }],
          }
        : {
            userId: user.id,
            connectorId: null,
          },
      orderBy: { lastActivityAt: 'desc' },
      take: 12,
    });

    return {
      sessions: sessions.map(toOpenClawSessionPayload),
      activeSessionId: sessions.find((session) => session.status === 'active')?.id ?? null,
    };
  });

  app.post('/v1/openclaw/sessions', async (request, reply) => {
    const user = await getUserOrReply(request, reply);
    if (!user) return;

    const body = createSessionSchema.parse(request.body ?? {});
    const connector = await resolveSelectedConnector(user.id);
    if (!connector) {
      return reply.code(400).send({ error: 'No connector is configured.' });
    }

    if (body.reuseSessionId) {
      const existing = await prisma.openClawSession.findFirst({
        where: {
          id: body.reuseSessionId,
          userId: user.id,
          OR: [{ connectorId: connector.id }, { connectorId: null }],
        },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'Session not found.' });
      }

      await prisma.$transaction([
        prisma.openClawSession.updateMany({
          where: {
            userId: user.id,
            NOT: { id: existing.id },
            status: 'active',
          },
          data: { status: 'idle' },
        }),
        prisma.openClawSession.update({
          where: { id: existing.id },
          data: {
            connectorId: connector.id,
            status: 'active',
            lastActivityAt: new Date(),
          },
        }),
      ]);

      const session = await prisma.openClawSession.findUniqueOrThrow({
        where: { id: existing.id },
      });
      return {
        session: toOpenClawSessionPayload(session),
      };
    }

    const created = await openClawConnector.createSession(connector, {
      title: body.title?.trim() || 'Window assistant session',
      preferredModel: body.preferredModel?.trim() || null,
    });

    await prisma.openClawSession.updateMany({
      where: {
        userId: user.id,
        status: 'active',
      },
      data: {
        status: 'idle',
      },
    });

    const session = await prisma.openClawSession.create({
      data: {
        userId: user.id,
        connectorId: connector.id,
        remoteSessionId: created.remoteSessionId,
        title: created.title,
        status: 'active',
        modelLabel: created.modelLabel,
        lastActivityAt: new Date(),
      },
    });

    return {
      session: toOpenClawSessionPayload(session),
    };
  });

  app.post('/v1/openclaw/jobs/:id/cancel', async (request, reply) => {
    const user = await getUserOrReply(request, reply);
    if (!user) return;

    const connector = await resolveSelectedConnector(user.id);
    const jobId = z.string().min(1).parse((request.params as { id?: string }).id);
    const job = await prisma.researchJob.findFirst({
      where: {
        id: jobId,
        idea: {
          userId: user.id,
          session: connector
            ? {
                connectorId: connector.id,
              }
            : undefined,
        },
      },
      include: {
        idea: true,
      },
    });

    if (!job) {
      return reply.code(404).send({ error: 'Job not found.' });
    }

    await prisma.$transaction([
      prisma.researchJob.update({
        where: { id: job.id },
        data: {
          status: 'cancelled',
          completedAt: new Date(),
          lastError: 'Cancelled by user.',
        },
      }),
      prisma.ideaCapture.update({
        where: { id: job.ideaId },
        data: {
          status: 'failed',
          lastError: 'Cancelled by user.',
        },
      }),
    ]);

    if (connector) {
      await openClawConnector.cancelJob(connector, job.remoteJobId);
    }
    return { ok: true };
  });

  app.post('/v1/assistant-tasks', async (request, reply) => {
    const user = await getUserOrReply(request, reply);
    if (!user) return;

    const body = createAssistantTaskSchema.parse(request.body ?? {});
    const connector = await resolveSelectedConnector(user.id);
    if (!connector) {
      return reply.code(400).send({ error: 'No connector is configured.' });
    }

    const session = await resolveOpenClawSession(user.id, {
      connectorId: connector.id,
      preferredModel: body.preferredModel ?? null,
      autoCreateSession: body.autoCreateSession,
      reuseActiveSession: body.reuseActiveSession,
      title: body.title?.trim() || `Task handoff: ${truncate(body.prompt.trim(), 48)}`,
    });

    const task = await prisma.assistantTask.create({
      data: {
        userId: user.id,
        connectorId: connector.id,
        prompt: body.prompt.trim(),
        title: body.title?.trim() || buildAssistantTaskTitle(body.prompt),
        preferredModel: body.preferredModel?.trim() || null,
        assistantNotes: body.notes?.trim() || null,
        status: 'queued',
        notificationMode: body.notificationMode,
        focusContextType: body.focusContextType,
        focusContextId: body.focusContextId ?? null,
        sessionId: session?.id ?? null,
        job: {
          create: {
            status: 'queued',
          },
        },
      },
      include: {
        job: true,
        result: true,
        session: true,
      },
    });

    return toAssistantTaskPayload(task);
  });

  app.get('/v1/assistant-tasks', async (request, reply) => {
    const user = await getUserOrReply(request, reply);
    if (!user) return;

    const connector = await resolveSelectedConnector(user.id);
    const tasks = await prisma.assistantTask.findMany({
      where: connector
        ? {
            userId: user.id,
            connectorId: connector.id,
          }
        : {
            userId: user.id,
          },
      include: {
        job: true,
        result: true,
        session: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });

    return {
      tasks: tasks.map(toAssistantTaskPayload),
    };
  });

  app.post('/v1/assistant-tasks/:id/cancel', async (request, reply) => {
    const user = await getUserOrReply(request, reply);
    if (!user) return;

    const connector = await resolveSelectedConnector(user.id);
    const taskId = z.string().min(1).parse((request.params as { id?: string }).id);
    const task = await prisma.assistantTask.findFirst({
      where: {
        id: taskId,
        userId: user.id,
        connectorId: connector?.id ?? undefined,
      },
      include: {
        job: true,
        result: true,
        session: true,
      },
    });

    if (!task) {
      return reply.code(404).send({ error: 'Task not found.' });
    }

    await prisma.$transaction([
      prisma.assistantTask.update({
        where: { id: task.id },
        data: {
          status: 'cancelled',
          completedAt: new Date(),
          lastError: 'Cancelled by user.',
        },
      }),
      prisma.assistantTaskJob.updateMany({
        where: { taskId: task.id },
        data: {
          status: 'cancelled',
          completedAt: new Date(),
          lastError: 'Cancelled by user.',
        },
      }),
    ]);

    if (connector) {
      await openClawConnector.cancelTask(connector, task.job?.remoteJobId ?? null);
    }

    return { ok: true };
  });

  app.post('/v1/assistant-tasks/:id/notification-ack', async (request, reply) => {
    const user = await getUserOrReply(request, reply);
    if (!user) return;

    const taskId = z.string().min(1).parse((request.params as { id?: string }).id);
    const task = await prisma.assistantTask.findFirst({
      where: {
        id: taskId,
        userId: user.id,
      },
    });

    if (!task) {
      return reply.code(404).send({ error: 'Task not found.' });
    }

    await prisma.assistantTask.update({
      where: { id: task.id },
      data: {
        notifiedAt: new Date(),
      },
    });

    return { ok: true };
  });

  app.post('/v1/ideas', async (request, reply) => {
    const user = await getUserOrReply(request, reply);
    if (!user) return;

    const body = createIdeaSchema.parse(request.body);
    const existing = await prisma.ideaCapture.findUnique({
      where: {
        userId_clientLocalId: {
          userId: user.id,
          clientLocalId: body.clientLocalId,
        },
      },
      include: {
        report: true,
        researchJob: true,
        session: true,
      },
    });

    if (existing) {
      return toIdeaRecordPayload(existing);
    }

    const connector = await resolveSelectedConnector(user.id);
    const session = await resolveIdeaSession(user.id, connector?.id ?? null, {
      preferredModel: body.preferredModel,
      autoCreateSession: body.autoCreateSession,
      reuseActiveSession: body.reuseActiveSession,
      prompt: body.prompt,
    });

    const idea = await prisma.ideaCapture.create({
      data: {
        userId: user.id,
        clientLocalId: body.clientLocalId,
        prompt: body.prompt.trim(),
        preferredModel: body.preferredModel?.trim() || null,
        assistantNotes: body.notes?.trim() || null,
        sessionId: session?.id ?? null,
        status: 'queued',
        researchJob: {
          create: {
            title: buildJobTitle(body.prompt),
            status: 'queued',
          },
        },
      },
      include: {
        report: true,
        researchJob: true,
        session: true,
      },
    });

    return toIdeaRecordPayload(idea);
  });

  app.get('/v1/ideas', async (request, reply) => {
    const user = await getUserOrReply(request, reply);
    if (!user) return;

    const ideas = await prisma.ideaCapture.findMany({
      where: { userId: user.id },
      include: {
        report: true,
        researchJob: true,
        session: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    return ideas.map(toIdeaRecordPayload);
  });

  app.get('/v1/ideas/:id', async (request, reply) => {
    const user = await getUserOrReply(request, reply);
    if (!user) return;

    const ideaId = z.string().min(1).parse((request.params as { id?: string }).id);
    const idea = await prisma.ideaCapture.findFirst({
      where: {
        id: ideaId,
        userId: user.id,
      },
      include: {
        report: true,
        researchJob: true,
        session: true,
      },
    });

    if (!idea) {
      return reply.code(404).send({ error: 'Idea not found.' });
    }

    return toIdeaRecordPayload(idea);
  });

  app.post('/v1/ideas/:id/decision', async (request, reply) => {
    const user = await getUserOrReply(request, reply);
    if (!user) return;

    const ideaId = z.string().min(1).parse((request.params as { id?: string }).id);
    const body = ideaDecisionSchema.parse(request.body);
    const idea = await prisma.ideaCapture.findFirst({
      where: {
        id: ideaId,
        userId: user.id,
      },
      include: {
        report: true,
        researchJob: true,
        session: true,
      },
    });

    if (!idea) {
      return reply.code(404).send({ error: 'Idea not found.' });
    }

    const updated = await prisma.ideaCapture.update({
      where: { id: idea.id },
      data: {
        status: body.decision === 'keep' ? 'kept' : 'discarded',
        saved: body.decision === 'keep',
        archived: body.decision === 'discard',
        lastError: null,
      },
      include: {
        report: true,
        researchJob: true,
        session: true,
      },
    });

    return toIdeaRecordPayload(updated);
  });

  app.post('/v1/ideas/:id/retry', async (request, reply) => {
    const user = await getUserOrReply(request, reply);
    if (!user) return;

    const ideaId = z.string().min(1).parse((request.params as { id?: string }).id);
    const idea = await prisma.ideaCapture.findFirst({
      where: {
        id: ideaId,
        userId: user.id,
      },
      include: {
        report: true,
        researchJob: true,
        session: true,
      },
    });

    if (!idea) {
      return reply.code(404).send({ error: 'Idea not found.' });
    }

    if (idea.report) {
      await prisma.ideaReport.delete({
        where: { ideaId: idea.id },
      });
    }

    const connector = await resolveSelectedConnector(user.id);
    const session = idea.sessionId
      ? idea.session
      : await resolveIdeaSession(user.id, connector?.id ?? null, {
          preferredModel: idea.preferredModel,
          autoCreateSession: true,
          reuseActiveSession: true,
          prompt: idea.prompt,
        });

    const updated = await prisma.$transaction(async (tx) => {
      if (idea.researchJob) {
        await tx.researchJob.update({
          where: { id: idea.researchJob.id },
          data: {
            status: 'queued',
            remoteJobId: null,
            lastError: null,
            startedAt: null,
            completedAt: null,
          },
        });
      } else {
        await tx.researchJob.create({
          data: {
            ideaId: idea.id,
            title: buildJobTitle(idea.prompt),
            status: 'queued',
          },
        });
      }

      return tx.ideaCapture.update({
        where: { id: idea.id },
        data: {
          status: 'queued',
          saved: false,
          archived: false,
          lastError: null,
          sessionId: session?.id ?? idea.sessionId,
        },
        include: {
          report: true,
          researchJob: true,
          session: true,
        },
      });
    });

    return toIdeaRecordPayload(updated);
  });

  app.post('/v1/break-visits/batch', async (request, reply) => {
    const user = await getUserOrReply(request, reply);
    if (!user) return;

    const body = breakVisitsSchema.parse(request.body);
    if (body.events.length === 0) {
      return { accepted: 0 };
    }

    await prisma.breakVisitEvent.createMany({
      data: body.events.map((event) => ({
        userId: user.id,
        tabId: event.tabId,
        domain: event.domain,
        activeEventTitle: event.activeEventTitle,
        startedAt: new Date(event.startedAt),
        endedAt: new Date(event.endedAt),
      })),
    });

    return {
      accepted: body.events.length,
    };
  });

  app.post('/v1/activity-sessions/batch', async (request, reply) => {
    const user = await getUserOrReply(request, reply);
    if (!user) return;

    const body = activitySessionsBatchSchema.parse(request.body);
    if (body.focusSessions.length === 0 && body.activitySessions.length === 0) {
      return { accepted: 0 };
    }

    const focusIdMap = new Map<string, string>();
    await prisma.$transaction(async (tx) => {
      for (const session of body.focusSessions) {
        const upserted = await tx.focusSession.upsert({
          where: {
            userId_clientSessionId: {
              userId: user.id,
              clientSessionId: session.id,
            },
          },
          update: {
            calendarEventId: session.calendarEventId,
            eventTitle: session.eventTitle,
            scheduledStart: new Date(session.scheduledStart),
            scheduledEnd: new Date(session.scheduledEnd),
            startedAt: new Date(session.startedAt),
            endedAt: new Date(session.endedAt),
            sourceRuleType: session.sourceRuleType,
            sourceRuleName: session.sourceRuleName,
            tagKey: session.tagKey,
            difficultyRank: session.difficultyRank,
            productiveMinutes: session.productiveMinutes,
            supportiveMinutes: session.supportiveMinutes,
            distractedMinutes: session.distractedMinutes,
            awayMinutes: session.awayMinutes,
            breakMinutes: session.breakMinutes,
            totalTrackedMinutes: session.totalTrackedMinutes,
            leftEarly: session.leftEarly,
          },
          create: {
            userId: user.id,
            clientSessionId: session.id,
            calendarEventId: session.calendarEventId,
            eventTitle: session.eventTitle,
            scheduledStart: new Date(session.scheduledStart),
            scheduledEnd: new Date(session.scheduledEnd),
            startedAt: new Date(session.startedAt),
            endedAt: new Date(session.endedAt),
            sourceRuleType: session.sourceRuleType,
            sourceRuleName: session.sourceRuleName,
            tagKey: session.tagKey,
            difficultyRank: session.difficultyRank,
            productiveMinutes: session.productiveMinutes,
            supportiveMinutes: session.supportiveMinutes,
            distractedMinutes: session.distractedMinutes,
            awayMinutes: session.awayMinutes,
            breakMinutes: session.breakMinutes,
            totalTrackedMinutes: session.totalTrackedMinutes,
            leftEarly: session.leftEarly,
          },
        });
        focusIdMap.set(session.id, upserted.id);
      }

      for (const activity of body.activitySessions) {
        const focusSessionId =
          focusIdMap.get(activity.focusSessionId) ??
          (
            await tx.focusSession.findUnique({
              where: {
                userId_clientSessionId: {
                  userId: user.id,
                  clientSessionId: activity.focusSessionId,
                },
              },
              select: { id: true },
            })
          )?.id;

        if (!focusSessionId) continue;

        await tx.activitySession.upsert({
          where: {
            userId_clientActivityId: {
              userId: user.id,
              clientActivityId: activity.id,
            },
          },
          update: {
            focusSessionId,
            calendarEventId: activity.calendarEventId,
            eventTitle: activity.eventTitle,
            domain: activity.domain,
            startedAt: new Date(activity.startedAt),
            endedAt: new Date(activity.endedAt),
            activityClass: activity.activityClass,
            tagKey: activity.tagKey,
            difficultyRank: activity.difficultyRank,
            sourceRuleType: activity.sourceRuleType,
            sourceRuleName: activity.sourceRuleName,
          },
          create: {
            userId: user.id,
            clientActivityId: activity.id,
            focusSessionId,
            calendarEventId: activity.calendarEventId,
            eventTitle: activity.eventTitle,
            domain: activity.domain,
            startedAt: new Date(activity.startedAt),
            endedAt: new Date(activity.endedAt),
            activityClass: activity.activityClass,
            tagKey: activity.tagKey,
            difficultyRank: activity.difficultyRank,
            sourceRuleType: activity.sourceRuleType,
            sourceRuleName: activity.sourceRuleName,
          },
        });
      }
    });

    await rebuildDailyAnalyticsAggregates(
      user.id,
      body.focusSessions.map((session) => session.startedAt),
    );

    return {
      accepted: body.focusSessions.length + body.activitySessions.length,
    };
  });

  app.get('/v1/analytics/interests', async (request, reply) => {
    const user = await getUserOrReply(request, reply);
    if (!user) return;

    const profiles = await prisma.interestProfile.findMany({
      where: { userId: user.id },
      orderBy: [
        { minutes: 'desc' },
        { updatedAt: 'desc' },
      ],
    });

    return {
      items: profiles.map(toInterestPayload),
    };
  });

  app.get('/v1/analytics/summary', async (request, reply) => {
    const user = await getUserOrReply(request, reply);
    if (!user) return;

    const range = analyticsRangeSchema.parse(
      (request.query as { range?: '7d' | '30d' } | undefined)?.range ?? '7d',
    );
    const cutoff = getRangeCutoff(range);
    const items = await prisma.dailyAnalyticsAggregate.findMany({
      where: {
        userId: user.id,
        day: {
          gte: cutoff,
        },
      },
      orderBy: { day: 'asc' },
    });

    return {
      summary: {
        range,
        productiveMinutes: items.reduce((sum, item) => sum + item.productiveMinutes, 0),
        supportiveMinutes: items.reduce((sum, item) => sum + item.supportiveMinutes, 0),
        distractedMinutes: items.reduce((sum, item) => sum + item.distractedMinutes, 0),
        awayMinutes: items.reduce((sum, item) => sum + item.awayMinutes, 0),
        breakMinutes: items.reduce((sum, item) => sum + item.breakMinutes, 0),
        totalFocusSessions: items.reduce((sum, item) => sum + item.totalFocusSessions, 0),
        leftEarlyCount: items.reduce((sum, item) => sum + item.leftEarlyCount, 0),
      },
    };
  });

  app.get('/v1/analytics/tags', async (request, reply) => {
    const user = await getUserOrReply(request, reply);
    if (!user) return;

    const range = analyticsRangeSchema.parse(
      (request.query as { range?: '7d' | '30d' } | undefined)?.range ?? '7d',
    );
    const cutoff = getRangeCutoff(range);
    const [sessions, tags] = await Promise.all([
      prisma.focusSession.findMany({
        where: {
          userId: user.id,
          startedAt: { gte: cutoff },
        },
        orderBy: { startedAt: 'desc' },
      }),
      prisma.taskTag.findMany({
        where: { userId: user.id },
      }),
    ]);

    return {
      items: buildTagBreakdownPayload(sessions, tags),
    };
  });

  app.get('/v1/analytics/sessions', async (request, reply) => {
    const user = await getUserOrReply(request, reply);
    if (!user) return;

    const range = analyticsRangeSchema.parse(
      (request.query as { range?: '7d' | '30d' } | undefined)?.range ?? '7d',
    );
    const cutoff = getRangeCutoff(range);
    const sessions = await prisma.focusSession.findMany({
      where: {
        userId: user.id,
        startedAt: { gte: cutoff },
      },
      orderBy: { startedAt: 'desc' },
      take: 48,
    });

    return {
      items: sessions.map(toFocusSessionPayload),
    };
  });

  app.post('/v1/analytics/overrides', async (request, reply) => {
    const user = await getUserOrReply(request, reply);
    if (!user) return;

    const body = analyticsOverrideSchema.parse(request.body);
    const focusSession = await prisma.focusSession.findUnique({
      where: {
        userId_clientSessionId: {
          userId: user.id,
          clientSessionId: body.focusSessionId,
        },
      },
    });

    if (!focusSession) {
      return reply.code(404).send({ error: 'Focus session not found.' });
    }

    await prisma.$transaction([
      prisma.analyticsOverride.upsert({
        where: { focusSessionId: focusSession.id },
        update: {
          tagKey: body.tagKey,
          difficultyRank: body.difficultyRank,
        },
        create: {
          userId: user.id,
          focusSessionId: focusSession.id,
          tagKey: body.tagKey,
          difficultyRank: body.difficultyRank,
        },
      }),
      prisma.focusSession.update({
        where: { id: focusSession.id },
        data: {
          tagKey: body.tagKey,
          difficultyRank: body.difficultyRank,
        },
      }),
    ]);

    await rebuildDailyAnalyticsAggregates(user.id, [focusSession.startedAt.toISOString()]);

    const updated = await prisma.focusSession.findUniqueOrThrow({
      where: { id: focusSession.id },
    });

    return {
      session: toFocusSessionPayload(updated),
    };
  });

  app.get('/v1/recommendations', async (request, reply) => {
    const user = await getUserOrReply(request, reply);
    if (!user) return;

    const items = await prisma.recommendation.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 12,
    });

    return {
      items: items.map(toRecommendationPayload),
    };
  });

  app.setErrorHandler((error, _request, reply) => {
    const statusCode = inferStatusCode(error);
    const message = toPublicErrorMessage(error);
    reply.code(statusCode).send({
      error: message,
    });
  });

  return app;
}

async function getUserOrReply(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ id: string; email: string | null } | null> {
  try {
    return await requireUser(request);
  } catch (error) {
    reply.code(401).send({
      error: error instanceof Error ? error.message : 'Unauthorized.',
    });
    return null;
  }
}

async function issueSessionPayload(
  userId: string,
  cachedUser?: {
    id: string;
    email: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
    createdAt: Date;
    providers?: AccountUserPayload['providers'];
  },
) {
  const session = await issueBackendSession(userId);
  const user =
    cachedUser ??
    (await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    }));

  return {
    sessionToken: session.sessionToken,
    userId,
    expiresAt: session.expiresAt,
    user: toAccountUserPayload({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
      providers: cachedUser?.providers ?? [],
    }),
  };
}

async function getAccountSnapshotResponse(
  userId: string,
): Promise<AccountSnapshotResponsePayload> {
  const snapshot = await prisma.userSyncState.findUnique({
    where: { userId },
  });

  if (!snapshot) {
    return {
      revision: 0,
      updatedAt: null,
      data: emptyAccountSnapshot(),
    };
  }

  return {
    revision: snapshot.revision,
    updatedAt: snapshot.updatedAt.toISOString(),
    data: toAccountSnapshotPayload(snapshot.snapshot),
  };
}

async function syncTaskTagsFromSnapshot(
  userId: string,
  snapshot: AccountSnapshotPayload,
): Promise<void> {
  if (snapshot.taskTags.length === 0) {
    await prisma.taskTag.deleteMany({ where: { userId } });
    return;
  }

  const incomingKeys = new Set(snapshot.taskTags.map((tag) => tag.key));
  await prisma.$transaction([
    prisma.taskTag.deleteMany({
      where: {
        userId,
        key: {
          notIn: [...incomingKeys],
        },
      },
    }),
    ...snapshot.taskTags.map((tag) =>
      prisma.taskTag.upsert({
        where: {
          userId_key: {
            userId,
            key: tag.key,
          },
        },
        update: {
          label: tag.label,
          color: tag.color,
          aliases: tag.aliases as unknown as Prisma.InputJsonValue,
          baselineDifficulty: tag.baselineDifficulty,
          alignedDomains: tag.alignedDomains as unknown as Prisma.InputJsonValue,
          supportiveDomains: tag.supportiveDomains as unknown as Prisma.InputJsonValue,
          source: tag.source,
        },
        create: {
          userId,
          key: tag.key,
          label: tag.label,
          color: tag.color,
          aliases: tag.aliases as unknown as Prisma.InputJsonValue,
          baselineDifficulty: tag.baselineDifficulty,
          alignedDomains: tag.alignedDomains as unknown as Prisma.InputJsonValue,
          supportiveDomains: tag.supportiveDomains as unknown as Prisma.InputJsonValue,
          source: tag.source,
        },
      }),
    ),
  ]);
}

async function rebuildDailyAnalyticsAggregates(
  userId: string,
  startedAtValues: string[],
): Promise<void> {
  const days = [...new Set(startedAtValues.map((value) => startOfUtcDay(value).toISOString()))];
  for (const day of days) {
    const start = new Date(day);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const sessions = await prisma.focusSession.findMany({
      where: {
        userId,
        startedAt: {
          gte: start,
          lt: end,
        },
      },
    });

    await prisma.dailyAnalyticsAggregate.upsert({
      where: {
        userId_day: {
          userId,
          day: start,
        },
      },
      update: {
        productiveMinutes: sessions.reduce((sum, session) => sum + session.productiveMinutes, 0),
        supportiveMinutes: sessions.reduce((sum, session) => sum + session.supportiveMinutes, 0),
        distractedMinutes: sessions.reduce((sum, session) => sum + session.distractedMinutes, 0),
        awayMinutes: sessions.reduce((sum, session) => sum + session.awayMinutes, 0),
        breakMinutes: sessions.reduce((sum, session) => sum + session.breakMinutes, 0),
        totalFocusSessions: sessions.length,
        leftEarlyCount: sessions.filter((session) => session.leftEarly).length,
      },
      create: {
        userId,
        day: start,
        productiveMinutes: sessions.reduce((sum, session) => sum + session.productiveMinutes, 0),
        supportiveMinutes: sessions.reduce((sum, session) => sum + session.supportiveMinutes, 0),
        distractedMinutes: sessions.reduce((sum, session) => sum + session.distractedMinutes, 0),
        awayMinutes: sessions.reduce((sum, session) => sum + session.awayMinutes, 0),
        breakMinutes: sessions.reduce((sum, session) => sum + session.breakMinutes, 0),
        totalFocusSessions: sessions.length,
        leftEarlyCount: sessions.filter((session) => session.leftEarly).length,
      },
    });
  }
}

function getRangeCutoff(range: '7d' | '30d'): Date {
  const days = range === '30d' ? 30 : 7;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function buildTagBreakdownPayload(
  sessions: Array<{
    tagKey: string | null;
    productiveMinutes: number;
    supportiveMinutes: number;
    distractedMinutes: number;
    awayMinutes: number;
    breakMinutes: number;
  }>,
  tags: Array<{
    key: string;
    label: string;
    color: string;
  }>,
) {
  const tagByKey = new Map(tags.map((tag) => [tag.key, tag]));
  const map = new Map<
    string,
    {
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
  >();

  for (const session of sessions) {
    if (!session.tagKey) continue;
    const tag = tagByKey.get(session.tagKey);
    const current = map.get(session.tagKey) ?? {
      tagKey: session.tagKey,
      label: tag?.label ?? humanizeTagKey(session.tagKey),
      color: tag?.color ?? '#64748b',
      productiveMinutes: 0,
      supportiveMinutes: 0,
      distractedMinutes: 0,
      awayMinutes: 0,
      breakMinutes: 0,
      sessions: 0,
    };

    current.productiveMinutes += session.productiveMinutes;
    current.supportiveMinutes += session.supportiveMinutes;
    current.distractedMinutes += session.distractedMinutes;
    current.awayMinutes += session.awayMinutes;
    current.breakMinutes += session.breakMinutes;
    current.sessions += 1;
    map.set(session.tagKey, current);
  }

  return [...map.values()].sort((a, b) => b.productiveMinutes - a.productiveMinutes);
}

function startOfUtcDay(value: string | Date): Date {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function humanizeTagKey(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

async function upsertGoogleUser(input: {
  googleSub: string;
  email: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
}) {
  const normalizedEmail = input.email?.trim().toLowerCase() ?? null;
  const normalizedDisplayName =
    typeof input.displayName === 'string' ? input.displayName.trim() || null : undefined;
  const normalizedAvatarUrl =
    typeof input.avatarUrl === 'string' ? input.avatarUrl.trim() || null : undefined;
  const existingIdentity = await prisma.authIdentity.findUnique({
    where: {
      provider_providerUserId: {
        provider: 'google',
        providerUserId: input.googleSub,
      },
    },
  });

  if (existingIdentity) {
    await prisma.$transaction([
      prisma.authIdentity.update({
        where: { id: existingIdentity.id },
        data: {
          email: normalizedEmail ?? existingIdentity.email,
          emailVerified: normalizedEmail !== null,
        },
      }),
      prisma.user.update({
        where: { id: existingIdentity.userId },
        data: {
          ...(normalizedEmail ? { email: normalizedEmail } : {}),
          ...(normalizedDisplayName !== undefined ? { displayName: normalizedDisplayName } : {}),
          ...(normalizedAvatarUrl !== undefined ? { avatarUrl: normalizedAvatarUrl } : {}),
        },
      }),
    ]);

    return prisma.user.findUniqueOrThrow({
      where: { id: existingIdentity.userId },
    });
  }

  const existingByEmail = normalizedEmail
    ? await prisma.user.findFirst({
        where: { email: normalizedEmail },
      })
    : null;
  const user =
    existingByEmail ??
    (await prisma.user.create({
      data: {
        email: normalizedEmail,
        displayName: normalizedDisplayName ?? null,
        avatarUrl: normalizedAvatarUrl ?? null,
      },
    }));

  await prisma.authIdentity.create({
    data: {
      userId: user.id,
      provider: 'google',
      providerUserId: input.googleSub,
      email: normalizedEmail,
      emailVerified: normalizedEmail !== null,
    },
  });

  return user;
}

async function resolveSelectedConnector(userId: string) {
  await openClawConnector.syncConnectionRecord();

  const [user, connectors] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { selectedConnectorId: true },
    }),
    prisma.openClawConnection.findMany({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const selected =
    connectors.find((connector) => connector.id === user?.selectedConnectorId) ??
    connectors[0] ??
    null;

  if (selected && user?.selectedConnectorId !== selected.id) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        selectedConnectorId: selected.id,
      },
    });
  }

  return selected
    ? {
        id: selected.id,
        key: selected.key,
        name: selected.name,
        transport: selected.transport,
        host: selected.host,
        baseUrl: selected.baseUrl,
        description: selected.description,
        enabled: selected.enabled,
      }
    : null;
}

async function resolveOpenClawSession(
  userId: string,
  input: {
    connectorId: string;
    preferredModel?: string | null;
    autoCreateSession: boolean;
    reuseActiveSession: boolean;
    title: string;
  },
) {
  let session =
    input.reuseActiveSession
      ? await prisma.openClawSession.findFirst({
          where: {
            userId,
            status: 'active',
            OR: [{ connectorId: input.connectorId }, { connectorId: null }],
          },
          orderBy: { lastActivityAt: 'desc' },
        })
      : null;

  if (!session && input.autoCreateSession) {
    const connector = await resolveSelectedConnector(userId);
    if (!connector || connector.id !== input.connectorId) {
      return null;
    }

    const created = await openClawConnector.createSession(connector, {
      title: input.title,
      preferredModel: input.preferredModel ?? null,
    });

    await prisma.openClawSession.updateMany({
      where: {
        userId,
        status: 'active',
      },
      data: {
        status: 'idle',
      },
    });

    session = await prisma.openClawSession.create({
      data: {
        userId,
        connectorId: input.connectorId,
        remoteSessionId: created.remoteSessionId,
        title: created.title,
        status: 'active',
        modelLabel: created.modelLabel,
        lastActivityAt: new Date(),
      },
    });
  }

  if (session) {
    await prisma.openClawSession.updateMany({
      where: {
        userId,
        NOT: { id: session.id },
        status: 'active',
      },
      data: {
        status: 'idle',
      },
    });

    return prisma.openClawSession.update({
      where: { id: session.id },
      data: {
        connectorId: input.connectorId,
        status: 'active',
        modelLabel: input.preferredModel?.trim() || session.modelLabel,
        lastActivityAt: new Date(),
      },
    });
  }

  return null;
}

async function resolveIdeaSession(
  userId: string,
  connectorId: string | null,
  input: {
    preferredModel?: string | null;
    autoCreateSession: boolean;
    reuseActiveSession: boolean;
    prompt: string;
  },
) {
  if (!connectorId) {
    return null;
  }

  return resolveOpenClawSession(userId, {
    connectorId,
    preferredModel: input.preferredModel,
    autoCreateSession: input.autoCreateSession,
    reuseActiveSession: input.reuseActiveSession,
    title: `Idea review: ${truncate(input.prompt, 48)}`,
  });
}

function applyCors(reply: FastifyReply): void {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
}

function buildJobTitle(prompt: string): string {
  return `Evaluate: ${truncate(prompt.trim(), 72)}`;
}

function buildAssistantTaskTitle(prompt: string): string {
  return `Handoff: ${truncate(prompt.trim(), 72)}`;
}

function getSessionTokenFromHeader(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice('Bearer '.length);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function inferStatusCode(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('does not exist in the current database')) {
    return 500;
  }

  if (/missing backend session token|expired|incorrect/i.test(message)) {
    return 401;
  }

  if (/not found/i.test(message)) {
    return 404;
  }

  if (/already exists|conflict/i.test(message)) {
    return 409;
  }

  return 400;
}

function toPublicErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('does not exist in the current database')) {
    return 'The backend database is missing the latest migration.';
  }
  return message;
}
