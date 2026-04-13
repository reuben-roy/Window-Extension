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
  const sampleNames = [
    'Avery', 'Mina', 'Jonah', 'Sora', 'Priya', 'Mateo', 'Noah', 'Layla',
    'Theo', 'Zara', 'Lucas', 'Ivy', 'Owen', 'Nadia', 'Eli', 'Mila',
    'Jasper', 'Lena', 'Kai', 'Amara', 'Rowan', 'Celine', 'Asher', 'Skye',
  ];
  const pointOffsets = [
    160, 128, 92, 51, 18,
    -8, -16, -24, -33, -42,
    -54, -66, -78, -92, -108,
    -124, -142, -161, -182, -204,
    -228, -254, -282, -312,
  ];

  const candidates = [
    ...sampleNames.map((name, index) => ({
      name,
      points: Math.max(0, benchmark + pointOffsets[index]),
      level: Math.max(1, level + leaderboardLevelOffset(pointOffsets[index])),
      isCurrentUser: false,
    })),
    { name: currentUser, points, level, isCurrentUser: true },
  ];

  return candidates
    .sort((a, b) => b.points - a.points)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

function leaderboardLevelOffset(pointOffset: number): number {
  if (pointOffset >= 90) return 2;
  if (pointOffset >= 20) return 1;
  if (pointOffset <= -180) return -2;
  if (pointOffset <= -20) return -1;
  return 0;
}
