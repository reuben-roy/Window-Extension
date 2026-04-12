import { describe, expect, it } from 'vitest';
import {
  calculatePoints,
  getBasePoints,
  getCarryoverMultiplier,
  getDurationMinutes,
  getDurationMultiplier,
  getRegularityMultiplier,
} from '../src/background/points';
import type { Task } from '../src/shared/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'test-id',
    eventTitle: 'Test Task',
    calendarEventId: 'cal-id',
    profile: 'Deep Work',
    scheduledStart: '2026-04-05T09:00:00',
    scheduledEnd: '2026-04-05T10:00:00', // 60 min
    status: 'active',
    carriedOverAt: null,
    expiresAt: null,
    completionNote: null,
    snoozesUsed: 0,
    maxSnoozes: 2,
    ...overrides,
  };
}

// ─── getDurationMinutes ───────────────────────────────────────────────────────

describe('getDurationMinutes', () => {
  it('returns 60 for a 1-hour block', () => {
    expect(getDurationMinutes(makeTask())).toBe(60);
  });

  it('returns 30 for a 30-minute block', () => {
    const task = makeTask({ scheduledEnd: '2026-04-05T09:30:00' });
    expect(getDurationMinutes(task)).toBe(30);
  });

  it('returns 120 for a 2-hour block', () => {
    const task = makeTask({ scheduledEnd: '2026-04-05T11:00:00' });
    expect(getDurationMinutes(task)).toBe(120);
  });
});

// ─── getDurationMultiplier ────────────────────────────────────────────────────

describe('getDurationMultiplier', () => {
  it('returns 1.0 for 30-min block', () => {
    expect(getDurationMultiplier(30)).toBe(1.0);
  });

  it('returns 1.5 for 60-min block', () => {
    expect(getDurationMultiplier(60)).toBe(1.5);
  });

  it('returns 2.0 for 120-min block', () => {
    expect(getDurationMultiplier(120)).toBe(2.0);
  });

  it('returns 2.5 for 180-min block (cap)', () => {
    expect(getDurationMultiplier(180)).toBe(2.5);
  });

  it('caps at 2.5 for blocks longer than 3 hours', () => {
    expect(getDurationMultiplier(240)).toBe(2.5);
  });

  it('returns 1.0 for sub-30-min blocks', () => {
    expect(getDurationMultiplier(15)).toBe(1.0);
  });
});

// ─── getBasePoints ────────────────────────────────────────────────────────────

describe('getBasePoints', () => {
  it('returns 10 for 30 minutes', () => {
    expect(getBasePoints(30)).toBe(10);
  });

  it('returns 20 for 60 minutes', () => {
    expect(getBasePoints(60)).toBe(20);
  });

  it('returns 0 for 15 minutes (less than one 30-min increment)', () => {
    expect(getBasePoints(15)).toBe(0);
  });

  it('returns 60 for 180 minutes', () => {
    expect(getBasePoints(180)).toBe(60);
  });
});

// ─── getRegularityMultiplier ──────────────────────────────────────────────────

describe('getRegularityMultiplier', () => {
  it('returns 1.0 for 0 consecutive completions', () => {
    expect(getRegularityMultiplier(0)).toBe(1.0);
  });

  it('decreases by 0.1 per streak', () => {
    expect(getRegularityMultiplier(1)).toBeCloseTo(0.9);
    expect(getRegularityMultiplier(2)).toBeCloseTo(0.8);
    expect(getRegularityMultiplier(5)).toBeCloseTo(0.5);
  });

  it('floors at 0.5', () => {
    expect(getRegularityMultiplier(10)).toBe(0.5);
    expect(getRegularityMultiplier(100)).toBe(0.5);
  });
});

// ─── getCarryoverMultiplier ───────────────────────────────────────────────────

describe('getCarryoverMultiplier', () => {
  it('returns 1.0 for non-carryover task', () => {
    expect(getCarryoverMultiplier(makeTask())).toBe(1.0);
  });

  it('returns 1.0 for active task even with carriedOverAt set', () => {
    // status is 'active', so no bonus
    const task = makeTask({ status: 'active', carriedOverAt: '2026-04-04T10:00:00' });
    expect(getCarryoverMultiplier(task)).toBe(1.0);
  });

  it('returns > 1.0 for completed carryover task', () => {
    const carriedOverAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days ago
    const task = makeTask({ status: 'completed', carriedOverAt });
    const multiplier = getCarryoverMultiplier(task);
    expect(multiplier).toBeGreaterThan(1.0);
    // 2 days × 0.25 = +0.5, so ~1.5
    expect(multiplier).toBeCloseTo(1.5, 0);
  });
});

// ─── calculatePoints ──────────────────────────────────────────────────────────

describe('calculatePoints', () => {
  it('calculates base points for a 60-min on-time completion', () => {
    // base=20, duration=1.5x, carryover=1.0x, regularity=1.0x, no bonuses
    // 20 × 1.5 × 1.0 × 1.0 = 30
    const points = calculatePoints({
      task: makeTask({ status: 'completed' }),
      consecutiveCompletions: 0,
      usedSnooze: false,
      completedEarly: false,
      isPerfectDayLastTask: false,
      completionTime: new Date('2026-04-05T09:55:00'),
    });
    // no-snooze bonus adds +20%, so 30 × 1.2 = 36
    expect(points).toBe(36);
  });

  it('applies no-snooze bonus when snooze was not used', () => {
    const withSnooze = calculatePoints({
      task: makeTask({ status: 'completed' }),
      consecutiveCompletions: 0,
      usedSnooze: true,
      completedEarly: false,
      isPerfectDayLastTask: false,
      completionTime: new Date('2026-04-05T09:55:00'),
    });
    const withoutSnooze = calculatePoints({
      task: makeTask({ status: 'completed' }),
      consecutiveCompletions: 0,
      usedSnooze: false,
      completedEarly: false,
      isPerfectDayLastTask: false,
      completionTime: new Date('2026-04-05T09:55:00'),
    });
    expect(withoutSnooze).toBeGreaterThan(withSnooze);
  });

  it('applies regularity decay for consecutive completions', () => {
    const fresh = calculatePoints({
      task: makeTask({ status: 'completed' }),
      consecutiveCompletions: 0,
      usedSnooze: true,
      completedEarly: false,
      isPerfectDayLastTask: false,
      completionTime: new Date(),
    });
    const stale = calculatePoints({
      task: makeTask({ status: 'completed' }),
      consecutiveCompletions: 5,
      usedSnooze: true,
      completedEarly: false,
      isPerfectDayLastTask: false,
      completionTime: new Date(),
    });
    expect(stale).toBeLessThan(fresh);
  });

  it('applies perfect day bonus on last task', () => {
    const normal = calculatePoints({
      task: makeTask({ status: 'completed' }),
      consecutiveCompletions: 0,
      usedSnooze: true,
      completedEarly: false,
      isPerfectDayLastTask: false,
      completionTime: new Date(),
    });
    const perfectDay = calculatePoints({
      task: makeTask({ status: 'completed' }),
      consecutiveCompletions: 0,
      usedSnooze: true,
      completedEarly: false,
      isPerfectDayLastTask: true,
      completionTime: new Date(),
    });
    expect(perfectDay).toBeGreaterThan(normal);
  });
});
