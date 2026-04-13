import { getLevelTitle, xpRequiredForLevel } from '../shared/constants';
import type { AllTimeStats } from '../shared/types';

// ─── Level calculation ────────────────────────────────────────────────────────

/** Returns the level corresponding to totalPoints. */
export function calculateLevel(totalPoints: number): number {
  let level = 1;
  while (totalPoints >= xpRequiredForLevel(level + 1)) {
    level++;
  }
  return level;
}

/** Returns how much XP is needed to reach the next level. */
export function xpToNextLevel(stats: AllTimeStats): number {
  return xpRequiredForLevel(stats.level + 1) - stats.totalPoints;
}

/**
 * Returns progress through the current level as a fraction [0, 1).
 * Used for the XP progress bar.
 */
export function levelProgress(stats: AllTimeStats): number {
  const currentLevelXP = xpRequiredForLevel(stats.level);
  const nextLevelXP = xpRequiredForLevel(stats.level + 1);
  if (nextLevelXP === currentLevelXP) return 0;
  return Math.max(0, Math.min(1, (stats.totalPoints - currentLevelXP) / (nextLevelXP - currentLevelXP)));
}

// ─── Stats update ─────────────────────────────────────────────────────────────

/** Adds points to allTimeStats and recalculates level/title. Returns true if leveled up. */
export function applyPointsToStats(stats: AllTimeStats, newPoints: number): { updated: AllTimeStats; leveledUp: boolean } {
  const totalPoints = Math.max(0, stats.totalPoints + newPoints);
  const level = calculateLevel(totalPoints);
  const title = getLevelTitle(level);
  const leveledUp = level > stats.level;
  return {
    updated: { ...stats, totalPoints, level, title },
    leveledUp,
  };
}
