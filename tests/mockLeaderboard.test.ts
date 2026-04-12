import { describe, expect, it } from 'vitest';
import { buildMockLeaderboard } from '../src/shared/mockLeaderboard';

function currentRank(points: number): number {
  return buildMockLeaderboard(points, 'You', 5).find((entry) => entry.isCurrentUser)?.rank ?? -1;
}

describe('buildMockLeaderboard', () => {
  it('includes visible point totals for every player', () => {
    const board = buildMockLeaderboard(1240, 'You', 5);

    expect(board.length).toBeGreaterThan(0);
    expect(board.every((entry) => typeof entry.points === 'number')).toBe(true);
  });

  it('drops the user rank after a 25-point unlock spend', () => {
    expect(currentRank(1240)).toBe(4);
    expect(currentRank(1215)).toBe(5);
  });

  it('improves the user rank after a task completion gain', () => {
    expect(currentRank(1240)).toBe(4);
    expect(currentRank(1276)).toBe(2);
  });
});
