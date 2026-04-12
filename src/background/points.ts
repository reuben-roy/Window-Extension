import {
  BASE_POINTS_PER_30_MIN,
  CARRYOVER_BONUS_PER_DAY,
  DURATION_MULTIPLIERS,
  EARLY_COMPLETION_BONUS,
  MONDAY_BONUS,
  NO_SNOOZE_BONUS,
  PERFECT_DAY_BONUS,
  REGULARITY_DECAY_FLOOR,
  REGULARITY_DECAY_PER_STREAK,
} from '../shared/constants';
import type { Task } from '../shared/types';

// ─── Calculation inputs ───────────────────────────────────────────────────────

export interface PointCalculationInput {
  task: Task;
  /** How many consecutive same-profile completions before this one */
  consecutiveCompletions: number;
  /** Whether the user used any snooze on this task */
  usedSnooze: boolean;
  /** Whether the user marked done before the scheduled end time */
  completedEarly: boolean;
  /** Whether this task is the final task completing a perfect day */
  isPerfectDayLastTask: boolean;
  /** Actual wall-clock time of completion */
  completionTime: Date;
}

// ─── Public formula functions ─────────────────────────────────────────────────

export function getDurationMinutes(task: Task): number {
  return (new Date(task.scheduledEnd).getTime() - new Date(task.scheduledStart).getTime()) / 60_000;
}

export function getDurationMultiplier(durationMinutes: number): number {
  for (const [minMinutes, multiplier] of DURATION_MULTIPLIERS) {
    if (durationMinutes >= minMinutes) return multiplier;
  }
  return 1.0;
}

export function getBasePoints(durationMinutes: number): number {
  return Math.floor(durationMinutes / 30) * BASE_POINTS_PER_30_MIN;
}

/**
 * Returns the carryover multiplier (>= 1.0).
 * Non-carryover tasks get 1.0. Carryover tasks get a bonus based on days waited.
 */
export function getCarryoverMultiplier(task: Task): number {
  if (task.status !== 'completed' || task.carriedOverAt === null) return 1.0;
  const daysInCarryover =
    (Date.now() - new Date(task.carriedOverAt).getTime()) / (1000 * 60 * 60 * 24);
  return 1.0 + daysInCarryover * CARRYOVER_BONUS_PER_DAY;
}

/**
 * Returns the regularity decay multiplier (0.5–1.0).
 * Floors at REGULARITY_DECAY_FLOOR to avoid zeroing out points.
 */
export function getRegularityMultiplier(consecutiveCompletions: number): number {
  return Math.max(
    REGULARITY_DECAY_FLOOR,
    1.0 - consecutiveCompletions * REGULARITY_DECAY_PER_STREAK,
  );
}

/**
 * Full points calculation applying all multipliers and bonuses.
 * Formula: basePoints × durationMultiplier × carryoverMultiplier × regularityDecay × bonuses
 */
export function calculatePoints(input: PointCalculationInput): number {
  const durationMinutes = getDurationMinutes(input.task);
  const base = getBasePoints(durationMinutes);
  const durationMultiplier = getDurationMultiplier(durationMinutes);
  const carryoverMultiplier = getCarryoverMultiplier(input.task);
  const regularityDecay = getRegularityMultiplier(input.consecutiveCompletions);

  let points = base * durationMultiplier * carryoverMultiplier * regularityDecay;

  // Apply additive bonus modifiers
  let bonusMultiplier = 1.0;
  if (!input.usedSnooze) bonusMultiplier += NO_SNOOZE_BONUS;
  if (input.completedEarly) bonusMultiplier += EARLY_COMPLETION_BONUS;
  if (input.isPerfectDayLastTask) bonusMultiplier += PERFECT_DAY_BONUS;
  if (input.completionTime.getDay() === 1 && input.task.carriedOverAt !== null) {
    bonusMultiplier += MONDAY_BONUS;
  }

  points *= bonusMultiplier;
  return Math.round(points);
}
