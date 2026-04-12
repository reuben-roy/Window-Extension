import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { openClawConnector } from './openclaw/client.js';

type ResearchJobWithIdea = Prisma.ResearchJobGetPayload<{
  include: {
    idea: {
      include: {
        session: true;
      };
    };
  };
}>;

export async function processNextResearchJob(): Promise<boolean> {
  const candidate = await claimNextResearchJob();
  if (!candidate) return false;

  const session = candidate.idea.session;
  if (!session) {
    await markJobFailed(
      candidate,
      'No OpenClaw session is attached. Start or reuse a session, then retry this idea.',
    );
    return true;
  }

  try {
    const result = await openClawConnector.evaluateIdea({
      prompt: candidate.idea.prompt,
      preferredModel: candidate.idea.preferredModel ?? session.modelLabel,
      notes: candidate.idea.assistantNotes,
      remoteSessionId: session.remoteSessionId,
      title: candidate.title,
    });

    const latest = await prisma.researchJob.findUnique({
      where: { id: candidate.id },
      select: { status: true },
    });
    if (!latest || latest.status === 'cancelled') {
      return true;
    }

    const completedAt = new Date(result.report.completedAt);
    await prisma.$transaction([
      prisma.researchJob.update({
        where: { id: candidate.id },
        data: {
          status: 'completed',
          remoteJobId: result.remoteJobId,
          lastError: null,
          completedAt: completedAt,
        },
      }),
      prisma.ideaCapture.update({
        where: { id: candidate.ideaId },
        data: {
          status: 'completed',
          lastError: null,
        },
      }),
      prisma.ideaReport.upsert({
        where: { ideaId: candidate.ideaId },
        create: {
          ideaId: candidate.ideaId,
          summary: result.report.summary,
          viability: result.report.viability,
          competitionSnapshot: result.report.competitionSnapshot,
          buildEffort: result.report.buildEffort,
          revenuePotential: result.report.revenuePotential,
          risks: result.report.risks,
          nextSteps: result.report.nextSteps,
          sourceLinks: result.report.sourceLinks,
          completedAt,
        },
        update: {
          summary: result.report.summary,
          viability: result.report.viability,
          competitionSnapshot: result.report.competitionSnapshot,
          buildEffort: result.report.buildEffort,
          revenuePotential: result.report.revenuePotential,
          risks: result.report.risks,
          nextSteps: result.report.nextSteps,
          sourceLinks: result.report.sourceLinks,
          completedAt,
        },
      }),
      prisma.openClawSession.update({
        where: { id: session.id },
        data: {
          remoteSessionId: result.remoteSessionId ?? session.remoteSessionId,
          modelLabel: result.modelLabel ?? session.modelLabel,
          status: 'active',
          lastActivityAt: new Date(),
        },
      }),
    ]);
  } catch (error) {
    await markJobFailed(
      candidate,
      error instanceof Error ? error.message : String(error),
    );
  }

  return true;
}

export async function processResearchJobsBatch(maxJobs = 5): Promise<number> {
  let processed = 0;

  while (processed < maxJobs) {
    const didWork = await processNextResearchJob();
    if (!didWork) break;
    processed += 1;
  }

  return processed;
}

async function claimNextResearchJob(): Promise<ResearchJobWithIdea | null> {
  const candidate = await prisma.researchJob.findFirst({
    where: { status: 'queued' },
    orderBy: { createdAt: 'asc' },
    include: {
      idea: {
        include: {
          session: true,
        },
      },
    },
  });

  if (!candidate) return null;

  const claimed = await prisma.researchJob.updateMany({
    where: {
      id: candidate.id,
      status: 'queued',
    },
    data: {
      status: 'running',
      startedAt: new Date(),
      lastError: null,
    },
  });

  if (!claimed.count) {
    return null;
  }

  await prisma.ideaCapture.update({
    where: { id: candidate.ideaId },
    data: {
      status: 'running',
      lastError: null,
    },
  });

  return prisma.researchJob.findUnique({
    where: { id: candidate.id },
    include: {
      idea: {
        include: {
          session: true,
        },
      },
    },
  });
}

async function markJobFailed(
  job: ResearchJobWithIdea,
  message: string,
): Promise<void> {
  const latest = await prisma.researchJob.findUnique({
    where: { id: job.id },
    select: { status: true },
  });
  if (!latest || latest.status === 'cancelled') {
    return;
  }

  await prisma.$transaction([
    prisma.researchJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        lastError: message,
        completedAt: new Date(),
      },
    }),
    prisma.ideaCapture.update({
      where: { id: job.ideaId },
      data: {
        status: 'failed',
        lastError: message,
      },
    }),
  ]);
}

