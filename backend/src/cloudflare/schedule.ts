export interface ProcessorSchedulingInput {
  processed: number;
  /** Jobs waiting to be claimed. */
  queued: number;
  /** Assistant tasks executing remotely that still need status polls. */
  polling: number;
  pollIntervalMs: number;
}

/** Floor for remote status polling; keeps an idle-but-running task from saturating the database. */
const REMOTE_POLL_MIN_INTERVAL_MS = 15_000;
const BUSY_DELAY_MS = 500;

/**
 * Delay before the next processing cycle, or null when the queues are drained.
 * Draining to null lets the processor go idle so the database can autosuspend;
 * the next enqueue (or the cron safety net) wakes it again.
 */
export function nextCycleDelayMs(input: ProcessorSchedulingInput): number | null {
  if (input.queued > 0) {
    return input.processed > 0 ? BUSY_DELAY_MS : input.pollIntervalMs;
  }
  if (input.polling > 0) {
    return Math.max(input.pollIntervalMs, REMOTE_POLL_MIN_INTERVAL_MS);
  }
  return null;
}
