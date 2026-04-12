export interface MockLeaderboardEntry {
  rank: number;
  name: string;
  points: number;
  level: number;
  isCurrentUser: boolean;
}

export function buildMockLeaderboard(
  points: number,
  currentUser: string,
  level: number,
): MockLeaderboardEntry[] {
  const candidates = [
    { name: 'Avery', points: points + 72, level: level + 1, isCurrentUser: false },
    { name: 'Mina', points: points + 28, level, isCurrentUser: false },
    { name: 'Jonah', points: points + 10, level, isCurrentUser: false },
    { name: currentUser, points, level, isCurrentUser: true },
    { name: 'Priya', points: Math.max(0, points - 14), level: Math.max(1, level - 1), isCurrentUser: false },
    { name: 'Mateo', points: Math.max(0, points - 47), level: Math.max(1, level - 1), isCurrentUser: false },
  ];

  return candidates
    .sort((a, b) => b.points - a.points)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}
