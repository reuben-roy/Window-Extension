import type { OpenClawConnection } from '@prisma/client';
import { prisma } from '../prisma.js';

export async function listOrderedConnectorsForUser(userId: string): Promise<OpenClawConnection[]> {
  const [personal, system] = await Promise.all([
    prisma.openClawConnection.findMany({
      where: { userId, enabled: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.openClawConnection.findMany({
      where: { userId: null, enabled: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  return [...personal, ...system];
}
