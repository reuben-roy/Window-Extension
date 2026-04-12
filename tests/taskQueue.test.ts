import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  expireStaleCarryoverTasks,
  getActiveAndCarryoverTasks,
  getOldestCarryoverTask,
} from '../src/background/taskQueue';
import type { Task } from '../src/shared/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: crypto.randomUUID(),
    eventTitle: 'Test Task',
    calendarEventId: 'cal-id',
    profile: 'Deep Work',
    scheduledStart: '2026-04-05T09:00:00',
    scheduledEnd: '2026-04-05T10:00:00',
    status: 'active',
    carriedOverAt: null,
    expiresAt: null,
    completionNote: null,
    snoozesUsed: 0,
    maxSnoozes: 2,
    ...overrides,
  };
}

// ─── getActiveAndCarryoverTasks ───────────────────────────────────────────────

describe('getActiveAndCarryoverTasks', () => {
  it('returns active and carryover tasks only', () => {
    const tasks: Task[] = [
      makeTask({ status: 'active' }),
      makeTask({ status: 'carryover' }),
      makeTask({ status: 'completed' }),
      makeTask({ status: 'expired' }),
      makeTask({ status: 'dismissed' }),
    ];
    const result = getActiveAndCarryoverTasks(tasks);
    expect(result).toHaveLength(2);
    expect(result.every((t) => t.status === 'active' || t.status === 'carryover')).toBe(true);
  });

  it('returns empty array when no pending tasks', () => {
    const tasks: Task[] = [
      makeTask({ status: 'completed' }),
      makeTask({ status: 'expired' }),
    ];
    expect(getActiveAndCarryoverTasks(tasks)).toHaveLength(0);
  });
});

// ─── getOldestCarryoverTask ───────────────────────────────────────────────────

describe('getOldestCarryoverTask', () => {
  it('returns the carryover task with the earliest carriedOverAt', () => {
    const older = makeTask({
      status: 'carryover',
      carriedOverAt: '2026-04-03T10:00:00',
    });
    const newer = makeTask({
      status: 'carryover',
      carriedOverAt: '2026-04-04T10:00:00',
    });
    expect(getOldestCarryoverTask([newer, older])?.id).toBe(older.id);
  });

  it('returns null when no carryover tasks', () => {
    expect(getOldestCarryoverTask([makeTask({ status: 'active' })])).toBeNull();
  });
});

// ─── expireStaleCarryoverTasks ────────────────────────────────────────────────

describe('expireStaleCarryoverTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('expires carryover tasks past their expiresAt', async () => {
    const expiredTask = makeTask({
      status: 'carryover',
      expiresAt: new Date(Date.now() - 1000).toISOString(), // 1 second ago
    });
    const freshTask = makeTask({
      status: 'carryover',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
    });

    // Mock storage to return our tasks
    const { default: chromeMock } = await import('../tests/setup');
    void chromeMock;

    // Re-mock get to return our queue
    (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockImplementation(
      (_key: string, callback: (r: Record<string, unknown>) => void) => {
        callback({ taskQueue: [expiredTask, freshTask] });
      },
    );

    const expiredCount = await expireStaleCarryoverTasks();
    expect(expiredCount).toBe(1);
  });

  it('returns 0 when no tasks are expired', async () => {
    const freshTask = makeTask({
      status: 'carryover',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockImplementation(
      (_key: string, callback: (r: Record<string, unknown>) => void) => {
        callback({ taskQueue: [freshTask] });
      },
    );

    const expiredCount = await expireStaleCarryoverTasks();
    expect(expiredCount).toBe(0);
  });
});
