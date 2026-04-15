import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyRequest } from 'fastify';
import type { AuthProvider } from '../types.js';
import { prisma } from './prisma.js';

const scrypt = promisify(scryptCallback);
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AUTH_CODE_TTL_MS = 10 * 60 * 1000;
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

export interface SignedAuthStatePayload {
  provider: Exclude<AuthProvider, 'password'>;
  redirectUri: string;
  clientState: string | null;
  expiresAt: number;
}

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

export async function fetchGoogleUserProfile(
  googleAccessToken: string,
): Promise<{
  displayName?: string | null;
  avatarUrl?: string | null;
}> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${googleAccessToken}`,
    },
  });

  if (!response.ok) {
    return {};
  }

  const payload = (await response.json()) as {
    name?: string;
    picture?: string;
  };

  return {
    displayName: payload.name?.trim() || null,
    avatarUrl: payload.picture?.trim() || null,
  };
}

export async function issueBackendSession(userId: string): Promise<{
  sessionToken: string;
  expiresAt: string;
}> {
  const sessionToken = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  await prisma.backendSession.create({
    data: {
      userId,
      tokenHash: hashSessionToken(sessionToken),
      expiresAt: new Date(expiresAt),
    },
  });

  return { sessionToken, expiresAt };
}

export async function revokeBackendSession(sessionToken: string): Promise<void> {
  await prisma.backendSession.deleteMany({
    where: {
      tokenHash: hashSessionToken(sessionToken),
    },
  });
}

export async function issueAuthCode(
  userId: string,
  provider: AuthProvider,
): Promise<string> {
  const code = randomUUID();
  await prisma.authCode.create({
    data: {
      userId,
      provider,
      codeHash: hashAuthCode(code),
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
    },
  });
  return code;
}

export async function consumeAuthCode(
  provider: AuthProvider,
  code: string,
): Promise<{ userId: string }> {
  const authCode = await prisma.authCode.findUnique({
    where: {
      codeHash: hashAuthCode(code),
    },
    select: {
      id: true,
      userId: true,
      provider: true,
      expiresAt: true,
    },
  });

  if (!authCode || authCode.provider !== provider) {
    throw new Error('OAuth exchange code is invalid.');
  }

  if (authCode.expiresAt.getTime() <= Date.now()) {
    await prisma.authCode.delete({
      where: { id: authCode.id },
    }).catch(() => undefined);
    throw new Error('OAuth exchange code expired.');
  }

  await prisma.authCode.delete({
    where: { id: authCode.id },
  });

  return { userId: authCode.userId };
}

export async function requireUser(
  request: FastifyRequest,
): Promise<{ id: string; email: string | null }> {
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
      user: {
        select: {
          id: true,
          email: true,
        },
      },
      expiresAt: true,
    },
  });

  if (!session || session.expiresAt.getTime() <= Date.now()) {
    throw new Error('Backend session is missing or expired.');
  }

  return {
    id: session.user.id,
    email: session.user.email,
  };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt.toString('base64')}:${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [saltBase64, hashBase64] = storedHash.split(':');
  if (!saltBase64 || !hashBase64) return false;

  const salt = Buffer.from(saltBase64, 'base64');
  const expected = Buffer.from(hashBase64, 'base64');
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return timingSafeEqual(expected, actual);
}

export function createSignedAuthState(
  payload: Omit<SignedAuthStatePayload, 'expiresAt'> & { expiresInMs?: number },
  secret: string,
): string {
  const normalized: SignedAuthStatePayload = {
    provider: payload.provider,
    redirectUri: payload.redirectUri,
    clientState: payload.clientState ?? null,
    expiresAt: Date.now() + (payload.expiresInMs ?? AUTH_CODE_TTL_MS),
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(normalized));
  const signature = signValue(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function verifySignedAuthState(
  token: string,
  secret: string,
): SignedAuthStatePayload {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) {
    throw new Error('OAuth state token is invalid.');
  }

  const expectedSignature = signValue(encodedPayload, secret);
  if (!safeEqual(encodedPayload, signature, expectedSignature)) {
    throw new Error('OAuth state signature is invalid.');
  }

  const payload = JSON.parse(decodeBase64Url(encodedPayload)) as SignedAuthStatePayload;
  if (payload.expiresAt <= Date.now()) {
    throw new Error('OAuth state token expired.');
  }

  return payload;
}

export function hashSessionToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashAuthCode(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function signValue(value: string, secret: string): string {
  return encodeBase64Url(createHmac('sha256', secret).update(value).digest());
}

function encodeBase64Url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(`${normalized}${'='.repeat(padding)}`, 'base64').toString('utf8');
}

function safeEqual(value: string, given: string, expected: string): boolean {
  const givenBuffer = Buffer.from(given);
  const expectedBuffer = Buffer.from(expected);
  if (givenBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(givenBuffer, expectedBuffer) && value.length > 0;
}
