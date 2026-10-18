import { bindings, defineConfig, exports, triggers } from 'cf/config';
import * as entrypoint from './src/cloudflare/index.ts' with { type: 'cf-worker' };

/**
 * Window backend on Cloudflare Workers.
 *
 * - fetch: the unchanged Fastify app, served through `app.inject`.
 * - JobProcessor: a Durable Object that is the single consumer of the Postgres
 *   job queues. It runs on demand (an enqueue request or the cron safety net)
 *   and re-arms an alarm only while work remains, so the database can idle.
 * - Hyperdrive pools connections to the external Postgres (Neon).
 *
 * Secrets are not declared here. Set them with `cf workers secrets` (names are
 * listed in docs/cloudflare-deployment.md).
 */
export default defineConfig({
  worker: {
    name: 'window-backend',
    compatibilityDate: '2026-10-06',
    compatibilityFlags: ['nodejs_compat'],
    entrypoint,
    domains: [{ hostname: 'api.window.explosion.fun', production: true, previews: false }],
    workersDev: false,
    observability: {
      enabled: true,
      logs: { enabled: true, invocationLogs: true },
      traces: { enabled: true },
    },
    env: {
      NODE_ENV: bindings.text('production'),
      OPENCLAW_TRANSPORT: bindings.text('mock'),
      OPENCLAW_FETCH_MODE: bindings.text('strict'),
      WORKER_POLL_INTERVAL_MS: bindings.text('5000'),
      CORS_ALLOWED_ORIGINS: bindings.text('chrome-extension://*'),
      HYPERDRIVE: bindings.hyperdrive({
        id: process.env.WINDOW_HYPERDRIVE_ID ?? 'unset',
        dev: { connectionString: process.env.WINDOW_LOCAL_DATABASE_URL },
      }),
      JOB_PROCESSOR: bindings.durableObject({
        worker: 'window-backend',
        exportName: 'JobProcessor',
      }),
    },
    exports: {
      JobProcessor: exports.durableObject({ storage: 'sqlite' }),
    },
    triggers: [
      // Safety net only: recovers missed wake-ups and fails interrupted jobs.
      triggers.scheduled({ schedule: '*/15 * * * *' }),
    ],
  },
});
