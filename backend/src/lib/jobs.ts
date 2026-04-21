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

type AssistantTaskJobWithTask = Prisma.AssistantTaskJobGetPayload<{
  include: {
    task: {
      include: {
        session: true;
        result: true;
      };
    };
  };
}>;

export async function processNextResearchJob(): Promise<boolean> {
  const candidate = await claimNextResearchJob();
  if (!candidate) return false;

  const session = candidate.idea.session;
  if (!session) {
    await markResearchJobFailed(
      candidate,
      'No OpenClaw session is attached. Start or reuse a session, then retry this idea.',
    );
    return true;
  }

  const connector = await resolveConnector(session.connectorId);
  if (!connector) {
    await markResearchJobFailed(
      candidate,
      'No assistant connector is available for the attached OpenClaw session.',
    );
    return true;
  }

  try {
    const result = await openClawConnector.evaluateIdea(connector, {
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
          completedAt,
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
          connectorId: connector.id,
          remoteSessionId: result.remoteSessionId ?? session.remoteSessionId,
          modelLabel: result.modelLabel ?? session.modelLabel,
          status: 'active',
          lastActivityAt: new Date(),
        },
      }),
    ]);
  } catch (error) {
    await markResearchJobFailed(
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

export async function processAssistantTasksBatch(maxJobs = 10): Promise<number> {
  let processed = 0;

  while (processed < maxJobs) {
    const didSubmit = await processNextQueuedAssistantTask();
    if (!didSubmit) break;
    processed += 1;
  }

  while (processed < maxJobs) {
    const didPoll = await pollNextRunningAssistantTask();
    if (!didPoll) break;
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

async function claimNextAssistantTaskJob(): Promise<AssistantTaskJobWithTask | null> {
  const candidate = await prisma.assistantTaskJob.findFirst({
    where: { status: 'queued' },
    orderBy: { createdAt: 'asc' },
    include: {
      task: {
        include: {
          session: true,
          result: true,
        },
      },
    },
  });

  if (!candidate) return null;

  const claimed = await prisma.assistantTaskJob.updateMany({
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

  await prisma.assistantTask.update({
    where: { id: candidate.taskId },
    data: {
      status: 'running',
      lastError: null,
    },
  });

  return prisma.assistantTaskJob.findUnique({
    where: { id: candidate.id },
    include: {
      task: {
        include: {
          session: true,
          result: true,
        },
      },
    },
  });
}

async function processNextQueuedAssistantTask(): Promise<boolean> {
  const candidate = await claimNextAssistantTaskJob();
  if (!candidate) return false;

  const connector = await resolveConnector(candidate.task.connectorId);
  if (!connector) {
    await markAssistantTaskFailed(
      candidate,
      'No assistant connector is available for this task.',
    );
    return true;
  }

  const session = candidate.task.session;
  if (!session) {
    await markAssistantTaskFailed(
      candidate,
      'No OpenClaw session is attached to this task.',
    );
    return true;
  }

  try {
    const result = await openClawConnector.createTask(connector, {
      prompt: candidate.task.prompt,
      preferredModel: candidate.task.preferredModel ?? session.modelLabel,
      notes: candidate.task.assistantNotes,
      remoteSessionId: session.remoteSessionId,
      title: candidate.task.title,
    });

    await prisma.$transaction([
      prisma.assistantTaskJob.update({
        where: { id: candidate.id },
        data: {
          remoteJobId: result.remoteJobId,
          status: 'running',
          lastError: null,
        },
      }),
      prisma.assistantTask.update({
        where: { id: candidate.taskId },
        data: {
          status: 'running',
          title: result.title,
          lastError: null,
        },
      }),
      prisma.openClawSession.update({
        where: { id: session.id },
        data: {
          connectorId: connector.id,
          remoteSessionId: result.remoteSessionId ?? session.remoteSessionId,
          modelLabel: result.modelLabel ?? session.modelLabel,
          status: 'active',
          lastActivityAt: new Date(),
        },
      }),
    ]);
  } catch (error) {
    await markAssistantTaskFailed(
      candidate,
      error instanceof Error ? error.message : String(error),
    );
  }

  return true;
}

async function pollNextRunningAssistantTask(): Promise<boolean> {
  const candidate = await prisma.assistantTaskJob.findFirst({
    where: { status: 'running' },
    orderBy: { updatedAt: 'asc' },
    include: {
      task: {
        include: {
          session: true,
          result: true,
        },
      },
    },
  });

  if (!candidate) return false;

  if (!candidate.remoteJobId) {
    await markAssistantTaskFailed(candidate, 'Remote assistant job id is missing.');
    return true;
  }

  const connector = await resolveConnector(candidate.task.connectorId);
  if (!connector) {
    await markAssistantTaskFailed(candidate, 'No assistant connector is available for this task.');
    return true;
  }

  try {
    const result = await openClawConnector.getTaskStatus(connector, candidate.remoteJobId);
    if (result.status === 'queued' || result.status === 'running') {
      return true;
    }

    if (result.status === 'completed') {
      const completedAt = new Date(result.completedAt ?? new Date().toISOString());
      await prisma.$transaction([
        prisma.assistantTaskJob.update({
          where: { id: candidate.id },
          data: {
            status: 'completed',
            lastError: null,
            completedAt,
          },
        }),
        prisma.assistantTask.update({
          where: { id: candidate.taskId },
          data: {
            status: 'completed',
            lastError: null,
            completedAt,
          },
        }),
        prisma.assistantTaskResult.upsert({
          where: { taskId: candidate.taskId },
          create: {
            taskId: candidate.taskId,
            summary: result.summary ?? 'Assistant task completed',
            output: result.output ?? 'No output was returned by the remote assistant.',
            completedAt,
          },
          update: {
            summary: result.summary ?? 'Assistant task completed',
            output: result.output ?? 'No output was returned by the remote assistant.',
            completedAt,
          },
        }),
        prisma.openClawSession.updateMany({
          where: candidate.task.sessionId
            ? {
                id: candidate.task.sessionId,
              }
            : {
                id: '__no_session__',
              },
          data: {
            remoteSessionId: result.remoteSessionId ?? candidate.task.session?.remoteSessionId,
            modelLabel: result.modelLabel ?? candidate.task.session?.modelLabel,
            status: 'active',
            lastActivityAt: new Date(),
          },
        }),
      ]);
      return true;
    }

    await prisma.$transaction([
      prisma.assistantTaskJob.update({
        where: { id: candidate.id },
        data: {
          status: result.status,
          lastError: result.error ?? 'Assistant task did not complete successfully.',
          completedAt: new Date(result.completedAt ?? new Date().toISOString()),
        },
      }),
      prisma.assistantTask.update({
        where: { id: candidate.taskId },
        data: {
          status: result.status,
          lastError: result.error ?? 'Assistant task did not complete successfully.',
          completedAt: new Date(result.completedAt ?? new Date().toISOString()),
        },
      }),
    ]);
  } catch (error) {
    await markAssistantTaskFailed(
      candidate,
      error instanceof Error ? error.message : String(error),
    );
  }

  return true;
}

async function markResearchJobFailed(
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

async function markAssistantTaskFailed(
  job: AssistantTaskJobWithTask,
  message: string,
): Promise<void> {
  const latest = await prisma.assistantTaskJob.findUnique({
    where: { id: job.id },
    select: { status: true },
  });
  if (!latest || latest.status === 'cancelled') {
    return;
  }

  await prisma.$transaction([
    prisma.assistantTaskJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        lastError: message,
        completedAt: new Date(),
      },
    }),
    prisma.assistantTask.update({
      where: { id: job.taskId },
      data: {
        status: 'failed',
        lastError: message,
        completedAt: new Date(),
      },
    }),
  ]);
}

async function resolveConnector(connectorId: string | null) {
  await openClawConnector.syncConnectionRecord();
  const connector =
    (connectorId
      ? await prisma.openClawConnection.findFirst({
          where: {
            id: connectorId,
            enabled: true,
          },
        })
      : null) ??
    (await prisma.openClawConnection.findFirst({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
    }));

  if (!connector) {
    return null;
  }

  return {
    id: connector.id,
    key: connector.key,
    name: connector.name,
    transport: connector.transport,
    host: connector.host,
    baseUrl: connector.baseUrl,
    description: connector.description,
    enabled: connector.enabled,
  };
}
