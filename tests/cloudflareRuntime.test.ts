import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { resolveCorsOrigin } from '../backend/src/lib/cors';
import { LATEST_MIGRATION, evaluateMigrations } from '../backend/src/lib/readiness';
import {
  enqueuesJobs,
  handleFetch,
  populateProcessEnv,
  type FetchDependencies,
} from '../backend/src/cloudflare/handler';
import { createConsoleLogger } from '../backend/src/cloudflare/logger';
import { nextCycleDelayMs } from '../backend/src/cloudflare/schedule';

describe('resolveCorsOrigin', () => {
  const extension = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

  it('allows any origin when no allowlist is configured', () => {
    expect(resolveCorsOrigin(undefined, [])).toBe('*');
    expect(resolveCorsOrigin('https://example.com', [])).toBe('*');
  });

  it('reflects extension origins matched by a scheme wildcard', () => {
    expect(resolveCorsOrigin(extension, ['chrome-extension://*'])).toBe(extension);
  });

  it('rejects other schemes, bare schemes, and missing origins', () => {
    const allowed = ['chrome-extension://*'];
    expect(resolveCorsOrigin('https://evil.example', allowed)).toBeNull();
    expect(resolveCorsOrigin('chrome-extension://', allowed)).toBeNull();
    expect(resolveCorsOrigin(undefined, allowed)).toBeNull();
  });

  it('matches exact origins', () => {
    expect(resolveCorsOrigin('https://app.example', ['https://app.example'])).toBe(
      'https://app.example',
    );
    expect(resolveCorsOrigin('https://other.example', ['https://app.example'])).toBeNull();
  });
});

describe('migration readiness', () => {
  it('tracks the newest checked-in migration', () => {
    const migrationsDir = path.resolve(process.cwd(), 'backend/prisma/migrations');
    const newest = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .at(-1);

    expect(LATEST_MIGRATION).toBe(newest);
  });

  it('reports the latest migration as applied only when it finished', () => {
    const finished = new Date();
    expect(
      evaluateMigrations([
        { migration_name: LATEST_MIGRATION, finished_at: finished, rolled_back_at: null },
      ]),
    ).toMatchObject({ latestApplied: true, failed: [] });

    expect(evaluateMigrations([])).toMatchObject({ latestApplied: false });
    expect(
      evaluateMigrations([
        { migration_name: LATEST_MIGRATION, finished_at: null, rolled_back_at: null },
      ]),
    ).toMatchObject({ latestApplied: false, failed: [LATEST_MIGRATION] });
    expect(
      evaluateMigrations([
        { migration_name: LATEST_MIGRATION, finished_at: finished, rolled_back_at: finished },
      ]),
    ).toMatchObject({ latestApplied: false, failed: [] });
  });
});

describe('job processor scheduling', () => {
  const base = { processed: 0, queued: 0, polling: 0, pollIntervalMs: 5_000 };

  it('goes idle once the queues are drained', () => {
    expect(nextCycleDelayMs(base)).toBeNull();
  });

  it('runs again quickly while work is being processed', () => {
    expect(nextCycleDelayMs({ ...base, processed: 3, queued: 2 })).toBe(500);
  });

  it('waits a poll interval when queued work could not be claimed', () => {
    expect(nextCycleDelayMs({ ...base, queued: 1 })).toBe(5_000);
  });

  it('polls remote tasks no faster than the floor interval', () => {
    expect(nextCycleDelayMs({ ...base, polling: 1 })).toBe(15_000);
    expect(nextCycleDelayMs({ ...base, polling: 1, pollIntervalMs: 60_000 })).toBe(60_000);
  });
});

describe('Cloudflare request handling', () => {
  function createDeps(response: Response, overrides: Partial<FetchDependencies> = {}) {
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const waited: Promise<unknown>[] = [];
    const deps: FetchDependencies = {
      dispatch: vi.fn().mockResolvedValue(response),
      createClient: vi.fn().mockReturnValue({ $disconnect: disconnect } as never),
      runWithClient: (_client, run) => run(),
      kickJobs: vi.fn().mockResolvedValue(undefined),
      waitUntil: (promise) => {
        waited.push(promise);
      },
      log: vi.fn(),
      ...overrides,
    };
    return { deps, disconnect, settle: () => Promise.all(waited) };
  }

  it('recognises only mutating routes that can enqueue jobs', () => {
    expect(enqueuesJobs('POST', '/v1/ideas')).toBe(true);
    expect(enqueuesJobs('POST', '/v1/ideas/abc/retry')).toBe(true);
    expect(enqueuesJobs('POST', '/v1/assistant-tasks')).toBe(true);
    expect(enqueuesJobs('POST', '/v1/learning/packs/p1/regenerate')).toBe(true);
    expect(enqueuesJobs('GET', '/v1/ideas')).toBe(false);
    expect(enqueuesJobs('POST', '/v1/analytics/overrides')).toBe(false);
  });

  it('wakes the job processor after a successful enqueue and always disconnects', async () => {
    const { deps, disconnect, settle } = createDeps(new Response('{}', { status: 200 }));

    const response = await handleFetch(new Request('https://api.test/v1/ideas', { method: 'POST' }), deps);
    await settle();

    expect(response.status).toBe(200);
    expect(deps.kickJobs).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('does not wake the processor for failed or read-only requests', async () => {
    const failed = createDeps(new Response('{}', { status: 400 }));
    await handleFetch(new Request('https://api.test/v1/ideas', { method: 'POST' }), failed.deps);
    const read = createDeps(new Response('{}', { status: 200 }));
    await handleFetch(new Request('https://api.test/v1/ideas'), read.deps);

    expect(failed.deps.kickJobs).not.toHaveBeenCalled();
    expect(read.deps.kickJobs).not.toHaveBeenCalled();
  });

  it('keeps serving when waking the processor fails', async () => {
    const { deps, settle } = createDeps(new Response('{}', { status: 200 }), {
      kickJobs: vi.fn().mockRejectedValue(new Error('processor unavailable')),
    });

    const response = await handleFetch(new Request('https://api.test/v1/ideas', { method: 'POST' }), deps);
    await settle();

    expect(response.status).toBe(200);
    expect(deps.log).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'job kick failed', err: expect.stringContaining('processor unavailable') }),
    );
  });

  it('disconnects the scoped client even when dispatch throws', async () => {
    const { deps, disconnect, settle } = createDeps(new Response(), {
      dispatch: vi.fn().mockRejectedValue(new Error('boom')),
    });

    await expect(handleFetch(new Request('https://api.test/healthz'), deps)).rejects.toThrow('boom');
    await settle();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('copies only string bindings into the environment', () => {
    const target: NodeJS.ProcessEnv = {};
    populateProcessEnv({ OPENCLAW_TRANSPORT: 'mock', HYPERDRIVE: { connectionString: 'x' }, N: 1 }, target);
    expect(target).toEqual({ OPENCLAW_TRANSPORT: 'mock' });
  });
});

describe('console logger', () => {
  it('writes structured JSON with bindings and serialised errors', () => {
    const sink = { debug: vi.fn(), log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const logger = createConsoleLogger({ service: 'window-backend' }, sink).child({ reqId: 'req-1' });

    logger.error({ err: new Error('db down'), url: '/v1/ideas' }, 'request failed');
    logger.info('plain message');

    const errorLine = JSON.parse(sink.error.mock.calls[0][0]);
    expect(errorLine).toMatchObject({
      level: 'error',
      service: 'window-backend',
      reqId: 'req-1',
      url: '/v1/ideas',
      msg: 'request failed',
      err: { name: 'Error', message: 'db down' },
    });
    expect(JSON.parse(sink.log.mock.calls[0][0])).toMatchObject({ level: 'info', msg: 'plain message' });
  });
});
