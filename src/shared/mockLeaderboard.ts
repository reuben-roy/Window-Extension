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
  const benchmark = Math.max(320, 1240 + (level - 5) * 140);
  const candidates = [
    { name: 'Avery', points: benchmark + 72, level: level + 1, isCurrentUser: false },
    { name: 'Mina', points: benchmark + 28, level, isCurrentUser: false },
    { name: 'Jonah', points: benchmark + 10, level, isCurrentUser: false },
    { name: currentUser, points, level, isCurrentUser: true },
    { name: 'Priya', points: Math.max(0, benchmark - 14), level: Math.max(1, level - 1), isCurrentUser: false },
    { name: 'Mateo', points: Math.max(0, benchmark - 47), level: Math.max(1, level - 1), isCurrentUser: false },
  ];

  return candidates
    .sort((a, b) => b.points - a.points)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}
