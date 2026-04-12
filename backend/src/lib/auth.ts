import { createHash, randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { prisma } from './prisma.js';

export async function verifyGoogleAccessToken(
  tokenInfoUrl: string,
  googleAccessToken: string,
): Promise<{ googleSub: string; email: string | null }> {
  const response = await fetch(
    `${tokenInfoUrl}?access_token=${encodeURIComponent(googleAccessToken)}`,
  );

  if (!response.ok) {
    throw new Error('Google token verification failed.');
  }

  const payload = (await response.json()) as {
    sub?: string;
    email?: string;
  };

  if (!payload.sub) {
    throw new Error('Google token did not return a subject.');
  }

  return {
    googleSub: payload.sub,
    email: payload.email ?? null,
  };
}

export async function issueBackendSession(userId: string): Promise<{
  sessionToken: string;
  expiresAt: string;
}> {
  const sessionToken = randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await prisma.backendSession.create({
    data: {
      userId,
      tokenHash: hashSessionToken(sessionToken),
      expiresAt: new Date(expiresAt),
    },
  });

  return { sessionToken, expiresAt };
}

export async function requireUser(request: FastifyRequest): Promise<{ id: string }> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing backend session token.');
  }

  const sessionToken = authHeader.slice('Bearer '.length);
  const session = await prisma.backendSession.findUnique({
    where: {
      tokenHash: hashSessionToken(sessionToken),
    },
    select: {
      userId: true,
      expiresAt: true,
    },
  });

  if (!session || session.expiresAt.getTime() <= Date.now()) {
    throw new Error('Backend session is missing or expired.');
  }

  return { id: session.userId };
}

export function hashSessionToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
