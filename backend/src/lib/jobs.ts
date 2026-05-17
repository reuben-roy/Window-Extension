import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import {
  buildSampleQuestions,
  sampleChaptersForTopic,
} from './learning.js';
import {
  openClawConnector,
  prismaRowToOpenClawConnectionConfig,
} from './openclaw/client.js';
import { listOrderedConnectorsForUser } from './openclaw/connectorList.js';

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

type LearningJobWithRelations = Prisma.LearningJobGetPayload<{
  include: {
    topic: true;
    pack: true;
    packVersion: true;
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

  const connector = await resolveConnector(session.connectorId, candidate.idea.userId);
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

export async function processLearningJobsBatch(maxJobs = 5): Promise<number> {
  let processed = 0;

  while (processed < maxJobs) {
    const didWork = await processNextLearningJob();
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

async function claimNextLearningJob(): Promise<LearningJobWithRelations | null> {
  const candidate = await prisma.learningJob.findFirst({
    where: { status: 'queued' },
    orderBy: { createdAt: 'asc' },
    include: {
      topic: true,
      pack: true,
      packVersion: true,
    },
  });
  if (!candidate) return null;

  const claimed = await prisma.learningJob.updateMany({
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

  if (!claimed.count) return null;

  return prisma.learningJob.findUnique({
    where: { id: candidate.id },
    include: {
      topic: true,
      pack: true,
      packVersion: true,
    },
  });
}

async function processNextLearningJob(): Promise<boolean> {
  const job = await claimNextLearningJob();
  if (!job) return false;

  try {
    if (!job.topicId && !job.packId) {
      throw new Error('Learning job is missing topic or pack context.');
    }

    let topic = job.topic;
    let pack = job.pack;
    if (!topic && pack?.topicId) {
      topic = await prisma.learningTopic.findUnique({ where: { id: pack.topicId } });
    }
    if (!topic) {
      throw new Error('Learning topic could not be resolved.');
    }

    const effectivePack =
      pack ??
      (await prisma.quizPack.findFirst({
        where: { topicId: topic.id, canonical: true },
        include: { source: true },
      }));

    const source =
      effectivePack?.sourceId
        ? (await prisma.learningSource.findUnique({ where: { id: effectivePack.sourceId } })) ??
          (await prisma.learningSource.create({
            data: {
              topicId: topic.id,
              title: `${topic.label} Reference Set`,
              provider: job.kind === 'pack_regeneration' ? 'Window Regenerated Pack' : 'Window Starter Corpus',
              sourceKind: 'textbook',
              licenseMode: 'commercial_safe',
              sourceUrl: null,
            },
          }))
        : await prisma.learningSource.create({
            data: {
              topicId: topic.id,
              title: `${topic.label} Reference Set`,
              provider: job.kind === 'pack_regeneration' ? 'Window Regenerated Pack' : 'Window Starter Corpus',
              sourceKind: 'textbook',
              licenseMode: 'commercial_safe',
              sourceUrl: null,
            },
          });

    const resolvedPack =
      effectivePack ??
      (await prisma.quizPack.create({
        data: {
          topicId: topic.id,
          sourceId: source.id,
          title: `${topic.label} Mastery Pack`,
          sourceKind: source.sourceKind,
          status: 'processing',
          canonical: true,
        },
      }));

    const chapterTitles = sampleChaptersForTopic(topic.label);
    const document = await prisma.learningDocument.create({
      data: {
        sourceId: source.id,
        title: `${topic.label} Study Guide`,
        content: `Structured notes for ${topic.label}.`,
        chapters: {
          create: chapterTitles.map((title, index) => ({
            ordinal: index + 1,
            title,
            summary: `Core concepts and review prompts for ${title}.`,
          })),
        },
      },
      include: {
        chapters: {
          orderBy: { ordinal: 'asc' },
        },
      },
    });

    const latestVersion = await prisma.quizPackVersion.findFirst({
      where: { packId: resolvedPack.id },
      orderBy: { versionNumber: 'desc' },
    });
    const nextVersionNumber = (latestVersion?.versionNumber ?? 0) + 1;

    const version = await prisma.quizPackVersion.create({
      data: {
        packId: resolvedPack.id,
        versionNumber: nextVersionNumber,
        licenseMode: source.licenseMode,
        generatedNote:
          job.kind === 'pack_regeneration'
            ? 'Regenerated from the latest canonical topic pack.'
            : 'Seeded starter pack generated by the learning worker.',
      },
    });

    let questionOrdinalOffset = 0;
    for (const chapter of document.chapters) {
      const questions = buildSampleQuestions(topic.label, chapter.title, questionOrdinalOffset);
      questionOrdinalOffset += questions.length;
      await prisma.quizQuestion.createMany({
        data: questions.map((question) => ({
          packVersionId: version.id,
          chapterId: chapter.id,
          ordinal: question.ordinal,
          difficulty: question.difficulty,
          prompt: question.prompt,
          choices: question.choices,
          correctChoiceId: question.correctChoiceId,
          hint: question.hint,
          explanation: question.explanation,
          wrongAnswerExplanations: question.wrongAnswerExplanations,
        })),
      });
    }

    await prisma.$transaction([
      prisma.quizPack.update({
        where: { id: resolvedPack.id },
        data: {
          status: 'ready',
          sourceId: source.id,
          updatedAt: new Date(),
        },
      }),
      prisma.learningJob.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          packId: resolvedPack.id,
          packVersionId: version.id,
          lastError: null,
          completedAt: new Date(),
        },
      }),
    ]);
  } catch (error) {
    await markLearningJobFailed(job, error instanceof Error ? error.message : String(error));
  }

  return true;
}

async function processNextQueuedAssistantTask(): Promise<boolean> {
  const candidate = await claimNextAssistantTaskJob();
  if (!candidate) return false;

  const connector = await resolveConnector(
    candidate.task.connectorId,
    candidate.task.userId,
  );
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

  const connector = await resolveConnector(
    candidate.task.connectorId,
    candidate.task.userId,
  );
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

async function markLearningJobFailed(
  job: LearningJobWithRelations,
  message: string,
): Promise<void> {
  const latest = await prisma.learningJob.findUnique({
    where: { id: job.id },
    select: { status: true },
  });
  if (!latest || latest.status === 'cancelled') {
    return;
  }

  await prisma.$transaction([
    prisma.learningJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        lastError: message,
        completedAt: new Date(),
      },
    }),
    ...(job.packId
      ? [
          prisma.quizPack.update({
            where: { id: job.packId },
            data: {
              status: 'failed',
            },
          }),
        ]
      : []),
  ]);
}

async function resolveConnector(connectorId: string | null, ownerUserId: string) {
  await openClawConnector.syncConnectionRecord();

  const ordered = await listOrderedConnectorsForUser(ownerUserId);
  if (!ordered.length) {
    return null;
  }

  let row = connectorId
    ? ordered.find((candidate) => candidate.id === connectorId) ??
      null
    : null;

  if (!row) {
    row = ordered[0] ?? null;
  }

  return row ? prismaRowToOpenClawConnectionConfig(row) : null;
}
