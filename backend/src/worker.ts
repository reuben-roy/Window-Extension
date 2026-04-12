import { env } from './env.js';
import { prisma } from './lib/prisma.js';
import { processResearchJobsBatch } from './lib/jobs.js';

let stopped = false;

process.on('SIGINT', () => {
  stopped = true;
});

process.on('SIGTERM', () => {
  stopped = true;
});

while (!stopped) {
  try {
    const processed = await processResearchJobsBatch();
    const delay = processed > 0 ? 500 : env.WORKER_POLL_INTERVAL_MS;
    await sleep(delay);
  } catch (error) {
    console.error('[window-worker] job loop failed', error);
    await sleep(env.WORKER_POLL_INTERVAL_MS);
  }
}

await prisma.$disconnect();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

