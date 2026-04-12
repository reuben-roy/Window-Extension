import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from './lib/prisma.js';
import { env } from './env.js';
import {
  issueBackendSession,
  requireUser,
  verifyGoogleAccessToken,
} from './lib/auth.js';
import { openClawConnector } from './lib/openclaw/client.js';
import {
  toIdeaRecordPayload,
  toInterestPayload,
  toOpenClawJobPayload,
  toOpenClawSessionPayload,
  toRecommendationPayload,
} from './lib/serializers.js';

const authExchangeSchema = z.object({
  googleAccessToken: z.string().min(1),
  extensionVersion: z.string().optional(),
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

  app.post('/v1/auth/google/exchange', async (request, reply) => {
    const body = authExchangeSchema.parse(request.body);
    const identity = await verifyGoogleAccessToken(
      env.GOOGLE_TOKENINFO_URL,
      body.googleAccessToken,
    );

    const user = await prisma.user.upsert({
      where: { googleSub: identity.googleSub },
      create: {
        googleSub: identity.googleSub,
        email: identity.email,
      },
      update: {
        email: identity.email,
      },
      select: {
        id: true,
      },
    });

    const session = await issueBackendSession(user.id);
    return {
      sessionToken: session.sessionToken,
      userId: user.id,
      expiresAt: session.expiresAt,
    };
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
    const message = error instanceof Error ? error.message : String(error);
    reply.code(statusCode).send({
      error: message,
    });
  });

  return app;
}

async function getUserOrReply(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ id: string } | null> {
  try {
    return await requireUser(request);
  } catch (error) {
    reply.code(401).send({
      error: error instanceof Error ? error.message : 'Unauthorized.',
    });
    return null;
  }
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
  reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

function buildJobTitle(prompt: string): string {
  return `Evaluate: ${truncate(prompt.trim(), 72)}`;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function inferStatusCode(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);

  if (/missing backend session token|expired/i.test(message)) {
    return 401;
  }

  if (/not found/i.test(message)) {
    return 404;
  }

  return 400;
}
