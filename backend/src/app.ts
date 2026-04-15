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

    return {
      revision: updated.revision,
      updatedAt: updated.updatedAt.toISOString(),
      data: toAccountSnapshotPayload(updated.snapshot),
    } satisfies AccountSnapshotResponsePayload;
  });

  app.get('/v1/openclaw/status', async (request, reply) => {
    const user = await getUserOrReply(request, reply);
    if (!user) return;

    await openClawConnector.syncConnectionRecord();
    const [status, currentJob] = await Promise.all([
      openClawConnector.getStatus(),
      prisma.researchJob.findFirst({
        where: {
          idea: { userId: user.id },
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

    const sessions = await prisma.openClawSession.findMany({
      where: { userId: user.id },
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

    if (body.reuseSessionId) {
      const existing = await prisma.openClawSession.findFirst({
        where: {
          id: body.reuseSessionId,
          userId: user.id,
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

    await openClawConnector.syncConnectionRecord();
    const created = await openClawConnector.createSession({
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

    const jobId = z.string().min(1).parse((request.params as { id?: string }).id);
    const job = await prisma.researchJob.findFirst({
      where: {
        id: jobId,
        idea: {
          userId: user.id,
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

    await openClawConnector.cancelJob(job.remoteJobId);
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

    const session = await resolveIdeaSession(user.id, {
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

    const session = idea.sessionId
      ? idea.session
      : await resolveIdeaSession(user.id, {
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

async function resolveIdeaSession(
  userId: string,
  input: {
    preferredModel?: string | null;
    autoCreateSession: boolean;
    reuseActiveSession: boolean;
    prompt: string;
  },
) {
  let session =
    input.reuseActiveSession
      ? await prisma.openClawSession.findFirst({
          where: {
            userId,
            status: 'active',
          },
          orderBy: { lastActivityAt: 'desc' },
        })
      : null;

  if (!session && input.autoCreateSession) {
    const created = await openClawConnector.createSession({
      title: `Idea review: ${truncate(input.prompt, 48)}`,
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
        status: 'active',
        modelLabel: input.preferredModel?.trim() || session.modelLabel,
        lastActivityAt: new Date(),
      },
    });
  }

  return null;
}

function applyCors(reply: FastifyReply): void {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
}

function buildJobTitle(prompt: string): string {
  return `Evaluate: ${truncate(prompt.trim(), 72)}`;
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
