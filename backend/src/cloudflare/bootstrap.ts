import { env } from 'cloudflare:workers';
import { populateProcessEnv } from './handler.js';

/**
 * Imported first by the entrypoint so process.env is complete before env.ts
 * validates it during module evaluation.
 */
populateProcessEnv(env as unknown as Record<string, unknown>);
// Every invocation connects through its own client built from the Hyperdrive
// binding (reading its connection string is not allowed at startup), so this
// placeholder only has to satisfy env validation.
process.env.DATABASE_URL = 'postgresql://hyperdrive.invalid/window';
