import './bootstrap.js';
import { handleAsNodeRequest } from 'cloudflare:node';
import { DurableObject } from 'cloudflare:workers';
import { buildApp } from '../app.js';
import { env as appEnv } from '../env.js';
import { runJobCycle } from '../lib/jobs.js';
import { createPrismaClient, withPrismaClient } from '../lib/prisma.js';
import { handleFetch } from './handler.js';
import { createConsoleLogger } from './logger.js';
import { nextCycleDelayMs } from './schedule.js';

interface WindowEnv {
  HYPERDRIVE: { connectionString: string };
  JOB_PROCESSOR: DurableObjectNamespace<JobProcessor>;
}

const PROCESSOR_NAME = 'primary';
const logger = createConsoleLogger({ service: 'window-backend' });

// Fastify's router compiles its lookup code with `new Function`, which the
// Workers runtime only allows while the module evaluates, so the app is built
// here. The port is a routing key for the Node HTTP shim, not a network port.
const NODE_SERVER_PORT = 8787;
const appPromise = buildApp({
  logger: logger as never,
  disableRequestLogging: true,
  // Plugin loading starts during startup, where timers are not allowed.
  pluginTimeout: 0,
});
let serverReady: Promise<void> | undefined;

function ensureServer(): Promise<void> {
  serverReady ??= appPromise.then(async (app) => {
    await app.ready();
    app.server.listen(NODE_SERVER_PORT);
  });
  return serverReady;
}

export default {
  async fetch(request: Request, env: WindowEnv, ctx: ExecutionContext): Promise<Response> {
    return handleFetch(request, {
      dispatch: async (incoming) => {
        await ensureServer();
        return handleAsNodeRequest(NODE_SERVER_PORT, incoming);
      },
      createClient: () => createPrismaClient(env.HYPERDRIVE.connectionString),
      runWithClient: withPrismaClient,
      kickJobs: () => env.JOB_PROCESSOR.getByName(PROCESSOR_NAME).kick(),
      waitUntil: (promise) => ctx.waitUntil(promise),
      log: (fields) => logger.info(fields),
    });
  },

  async scheduled(_controller: ScheduledController, env: WindowEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(env.JOB_PROCESSOR.getByName(PROCESSOR_NAME).kick());
  },
} satisfies ExportedHandler<WindowEnv>;

/**
 * Single consumer of the Postgres job queues. A Durable Object runs one alarm
 * at a time, so cycles never overlap even if kicks arrive concurrently; jobs
 * are additionally claimed with conditional updates.
 */
export class JobProcessor extends DurableObject<WindowEnv> {
  /** Requests a cycle as soon as possible; a no-op if one is already imminent. */
  async kick(): Promise<void> {
    const scheduled = await this.ctx.storage.getAlarm();
    const now = Date.now();
    if (scheduled === null || scheduled > now + 1_000) {
      await this.ctx.storage.setAlarm(now);
    }
  }

  async alarm(): Promise<void> {
    let delay: number | null;
    const client = createPrismaClient(this.env.HYPERDRIVE.connectionString);
    try {
      const cycle = await withPrismaClient(client, () => runJobCycle());
      logger.info({ msg: 'job cycle', ...cycle });
      delay = nextCycleDelayMs({
        processed: cycle.processed,
        queued: cycle.queued,
        polling: cycle.polling,
        pollIntervalMs: appEnv.WORKER_POLL_INTERVAL_MS,
      });
    } catch (error) {
      logger.error({ msg: 'job cycle failed', err: error });
      // Retry later instead of throwing, which would trigger rapid platform retries.
      delay = 30_000;
    } finally {
      await client.$disconnect().catch(() => undefined);
    }

    if (delay !== null) {
      await this.ctx.storage.setAlarm(Date.now() + delay);
    }
  }
}
