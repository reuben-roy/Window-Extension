import { DEFAULT_TASK_TTL_DAYS } from '../shared/constants';
import { getSettings, getTaskQueue, setTaskQueue } from '../shared/storage';
import type { Task, TaskStatus } from '../shared/types';

// ─── Queue mutations ──────────────────────────────────────────────────────────

export async function addTask(task: Task): Promise<void> {
  const queue = await getTaskQueue();
  queue.push(task);
  await setTaskQueue(queue);
}

export async function updateTask(id: string, updates: Partial<Task>): Promise<void> {
  const queue = await getTaskQueue();
  const idx = queue.findIndex((t) => t.id === id);
  if (idx !== -1) {
    queue[idx] = { ...queue[idx], ...updates };
    await setTaskQueue(queue);
  }
}

// ─── Carryover ────────────────────────────────────────────────────────────────

/**
 * Transitions an active task to carryover when its calendar block has ended.
 * Sets expiresAt based on taskTTLDays from settings.
 */
export async function carryOverTask(taskId: string): Promise<void> {
  const [queue, settings] = await Promise.all([getTaskQueue(), getSettings()]);
  const idx = queue.findIndex((t) => t.id === taskId);
  if (idx === -1) return;

  const task = queue[idx];
  const ttlDays = settings.taskTTLDays ?? DEFAULT_TASK_TTL_DAYS;
  const scheduledEnd = new Date(task.scheduledEnd);
  const expiresAt = new Date(scheduledEnd.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

  queue[idx] = {
    ...task,
    status: 'carryover' as TaskStatus,
    carriedOverAt: new Date().toISOString(),
    expiresAt,
  };

  await setTaskQueue(queue);
}

// ─── Expiration ───────────────────────────────────────────────────────────────

/**
 * Marks carryover tasks as expired when now > expiresAt.
 * Returns the number of tasks that were expired.
 */
export async function expireStaleCarryoverTasks(): Promise<number> {
  const queue = await getTaskQueue();
  const now = new Date();
  let count = 0;

  const updated = queue.map((task) => {
    if (task.status === 'carryover' && task.expiresAt && new Date(task.expiresAt) <= now) {
      count++;
      return { ...task, status: 'expired' as TaskStatus };
    }
    return task;
  });

  if (count > 0) await setTaskQueue(updated);
  return count;
}

/**
 * Monthly hard reset: clears all tasks when we've crossed into a new month.
 * Updates settings.lastMonthlyReset if a reset occurs.
 */
export async function checkMonthlyReset(): Promise<boolean> {
  const settings = await getSettings();
  if (!settings.monthlyResetEnabled) return false;

  const last = new Date(settings.lastMonthlyReset);
  const now = new Date();
  const isNewMonth = now.getFullYear() > last.getFullYear() || now.getMonth() > last.getMonth();
  if (!isNewMonth) return false;

  await setTaskQueue([]);
  await import('../shared/storage').then(({ setSettings }) =>
    setSettings({
      ...settings,
      lastMonthlyReset: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
    }),
  );

  return true;
}

// ─── Query helpers ────────────────────────────────────────────────────────────

export function getActiveAndCarryoverTasks(queue: Task[]): Task[] {
  return queue.filter((t) => t.status === 'active' || t.status === 'carryover');
}

export function getOldestCarryoverTask(queue: Task[]): Task | null {
  const carryover = queue
    .filter((t) => t.status === 'carryover' && t.carriedOverAt !== null)
    .sort((a, b) => new Date(a.carriedOverAt!).getTime() - new Date(b.carriedOverAt!).getTime());
  return carryover[0] ?? null;
}
