import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  researchJob: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  learningJob: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  assistantTaskJob: { count: vi.fn() },
  ideaCapture: { update: vi.fn() },
  quizPack: { update: vi.fn() },
  $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
}));

vi.mock('../backend/src/lib/prisma', () => ({ prisma: prismaMock }));

process.env.DATABASE_URL ??= 'postgresql://window:window@127.0.0.1:5432/window';

const { countPendingJobs, failStaleJobs } = await import('../backend/src/lib/jobs');

const NOW = new Date('2026-10-18T12:00:00.000Z');
const TEN_MINUTES = 10 * 60 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.researchJob.findMany.mockResolvedValue([]);
  prismaMock.learningJob.findMany.mockResolvedValue([]);
  prismaMock.researchJob.update.mockResolvedValue({});
  prismaMock.learningJob.update.mockResolvedValue({});
  prismaMock.ideaCapture.update.mockResolvedValue({});
  prismaMock.quizPack.update.mockResolvedValue({});
});

describe('failStaleJobs', () => {
  it('only looks at jobs that started before the stale cutoff', async () => {
    await failStaleJobs(NOW, TEN_MINUTES);

    const cutoff = new Date(NOW.getTime() - TEN_MINUTES);
    expect(prismaMock.researchJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'running', startedAt: { lt: cutoff } } }),
    );
    expect(prismaMock.learningJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'running', startedAt: { lt: cutoff } } }),
    );
  });

  it('fails interrupted research jobs and their ideas so they can be retried', async () => {
    prismaMock.researchJob.findMany.mockResolvedValue([{ id: 'job-1', ideaId: 'idea-1' }]);
    prismaMock.researchJob.findUnique.mockResolvedValue({ status: 'running' });

    const failed = await failStaleJobs(NOW, TEN_MINUTES);

    expect(failed).toBe(1);
    expect(prismaMock.researchJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({ status: 'failed', lastError: expect.stringContaining('Retry') }),
      }),
    );
    expect(prismaMock.ideaCapture.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'idea-1' }, data: expect.objectContaining({ status: 'failed' }) }),
    );
  });

  it('fails interrupted learning jobs and marks their pack failed', async () => {
    prismaMock.learningJob.findMany.mockResolvedValue([{ id: 'learn-1', packId: 'pack-1' }]);
    prismaMock.learningJob.findUnique.mockResolvedValue({ status: 'running' });

    const failed = await failStaleJobs(NOW, TEN_MINUTES);

    expect(failed).toBe(1);
    expect(prismaMock.learningJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'learn-1' }, data: expect.objectContaining({ status: 'failed' }) }),
    );
    expect(prismaMock.quizPack.update).toHaveBeenCalledWith({
      where: { id: 'pack-1' },
      data: { status: 'failed' },
    });
  });

  it('leaves jobs that were cancelled in the meantime untouched', async () => {
    prismaMock.researchJob.findMany.mockResolvedValue([{ id: 'job-1', ideaId: 'idea-1' }]);
    prismaMock.researchJob.findUnique.mockResolvedValue({ status: 'cancelled' });

    await failStaleJobs(NOW, TEN_MINUTES);

    expect(prismaMock.researchJob.update).not.toHaveBeenCalled();
  });
});

describe('countPendingJobs', () => {
  it('separates claimable work from remote tasks that need polling', async () => {
    prismaMock.researchJob.count.mockResolvedValue(2);
    prismaMock.learningJob.count.mockResolvedValue(1);
    prismaMock.assistantTaskJob.count.mockImplementation(async ({ where }: { where: { status: string } }) =>
      where.status === 'queued' ? 4 : 3,
    );

    await expect(countPendingJobs()).resolves.toEqual({ queued: 7, polling: 3 });
  });
});
