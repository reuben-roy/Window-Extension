import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { env } from '../../env.js';
import type { IdeaReportPayload } from '../../types.js';
import { prisma } from '../prisma.js';

const execFileAsync = promisify(execFile);

const remoteHealthSchema = z
  .object({
    connected: z.boolean().optional(),
    healthy: z.boolean().optional(),
    label: z.string().nullable().optional(),
    message: z.string().nullable().optional(),
  })
  .partial();

const remoteSessionSchema = z
  .object({
    sessionId: z.string().optional(),
    remoteSessionId: z.string().optional(),
    title: z.string().optional(),
    modelLabel: z.string().nullable().optional(),
  })
  .partial();

const remoteEvaluationSchema = z
  .object({
    remoteJobId: z.string().nullable().optional(),
    jobId: z.string().nullable().optional(),
    remoteSessionId: z.string().nullable().optional(),
    sessionId: z.string().nullable().optional(),
    modelLabel: z.string().nullable().optional(),
    report: z.unknown().optional(),
    summary: z.string().optional(),
    viability: z.string().optional(),
    competitionSnapshot: z.string().optional(),
    buildEffort: z.string().optional(),
    revenuePotential: z.string().optional(),
    risks: z.array(z.string()).optional(),
    nextSteps: z.array(z.string()).optional(),
    sourceLinks: z.array(z.string()).optional(),
    completedAt: z.string().optional(),
  })
  .partial();

export interface OpenClawStatus {
  connected: boolean;
  healthy: boolean;
  transport: 'ssh' | 'http' | 'unknown';
  label: string | null;
  message: string | null;
  lastCheckedAt: string | null;
}

export interface OpenClawSessionCreateResult {
  remoteSessionId: string | null;
  title: string;
  modelLabel: string | null;
}

export interface OpenClawEvaluationInput {
  prompt: string;
  preferredModel?: string | null;
  notes?: string | null;
  remoteSessionId?: string | null;
  title?: string | null;
}

export interface OpenClawEvaluationResult {
  remoteJobId: string | null;
  remoteSessionId: string | null;
  modelLabel: string | null;
  report: IdeaReportPayload;
}

export interface OpenClawConnector {
  syncConnectionRecord(): Promise<void>;
  getStatus(): Promise<OpenClawStatus>;
  createSession(input: { title: string; preferredModel?: string | null }): Promise<OpenClawSessionCreateResult>;
  evaluateIdea(input: OpenClawEvaluationInput): Promise<OpenClawEvaluationResult>;
  cancelJob(remoteJobId: string | null): Promise<void>;
}

export const openClawConnector: OpenClawConnector = {
  async syncConnectionRecord() {
    const existing = await prisma.openClawConnection.findFirst({
      where: { name: 'Primary OpenClaw' },
      select: { id: true },
    });

    const transport = env.OPENCLAW_TRANSPORT === 'mock' ? 'mock' : env.OPENCLAW_TRANSPORT;
    const host =
      env.OPENCLAW_TRANSPORT === 'ssh'
        ? env.OPENCLAW_SSH_HOST || null
        : null;
    const baseUrl =
      env.OPENCLAW_TRANSPORT === 'http'
        ? env.OPENCLAW_HTTP_BASE_URL || null
        : env.OPENCLAW_REMOTE_BASE_URL || null;

    if (existing) {
      await prisma.openClawConnection.update({
        where: { id: existing.id },
        data: {
          transport,
          host,
          baseUrl,
          enabled: true,
        },
      });
      return;
    }

    await prisma.openClawConnection.create({
      data: {
        name: 'Primary OpenClaw',
        transport,
        host,
        baseUrl,
        enabled: true,
      },
    });
  },

  async getStatus() {
    const now = new Date().toISOString();

    if (env.OPENCLAW_TRANSPORT === 'mock') {
      return {
        connected: true,
        healthy: true,
        transport: 'unknown',
        label: 'Mock OpenClaw',
        message: 'Mock transport is enabled for local development.',
        lastCheckedAt: now,
      } satisfies OpenClawStatus;
    }

    try {
      const response = await remoteRequest('/api/window/health', { method: 'GET' });
      const parsed = remoteHealthSchema.parse(response);

      return {
        connected: parsed.connected ?? true,
        healthy: parsed.healthy ?? true,
        transport: env.OPENCLAW_TRANSPORT,
        label: parsed.label ?? 'OpenClaw',
        message: parsed.message ?? 'OpenClaw is reachable.',
        lastCheckedAt: now,
      } satisfies OpenClawStatus;
    } catch (error) {
      return {
        connected: false,
        healthy: false,
        transport: env.OPENCLAW_TRANSPORT,
        label: 'OpenClaw',
        message: error instanceof Error ? error.message : String(error),
        lastCheckedAt: now,
      } satisfies OpenClawStatus;
    }
  },

  async createSession({ title, preferredModel }) {
    if (env.OPENCLAW_TRANSPORT === 'mock') {
      return {
        remoteSessionId: `mock-session-${randomUUID()}`,
        title,
        modelLabel: preferredModel?.trim() || 'Mock OpenClaw model',
      } satisfies OpenClawSessionCreateResult;
    }

    const response = await remoteRequest('/api/window/sessions', {
      method: 'POST',
      body: {
        title,
        preferredModel: preferredModel?.trim() || undefined,
      },
    });
    const parsed = remoteSessionSchema.parse(response);

    return {
      remoteSessionId: parsed.remoteSessionId ?? parsed.sessionId ?? null,
      title: parsed.title ?? title,
      modelLabel: parsed.modelLabel ?? preferredModel ?? null,
    } satisfies OpenClawSessionCreateResult;
  },

  async evaluateIdea(input) {
    if (env.OPENCLAW_TRANSPORT === 'mock') {
      await sleep(env.OPENCLAW_MOCK_LATENCY_MS);
      const remoteSessionId = input.remoteSessionId ?? `mock-session-${randomUUID()}`;
      return {
        remoteJobId: `mock-job-${randomUUID()}`,
        remoteSessionId,
        modelLabel: input.preferredModel?.trim() || 'Mock OpenClaw model',
        report: buildMockReport(input.prompt),
      } satisfies OpenClawEvaluationResult;
    }

    const response = await remoteRequest('/api/window/ideas/evaluate', {
      method: 'POST',
      body: {
        prompt: input.prompt,
        preferredModel: input.preferredModel?.trim() || undefined,
        notes: input.notes?.trim() || undefined,
        sessionId: input.remoteSessionId ?? undefined,
        title: input.title ?? undefined,
      },
    });
    const parsed = remoteEvaluationSchema.parse(response);
    const report = normalizeRemoteReport(parsed, input.prompt);

    return {
      remoteJobId: parsed.remoteJobId ?? parsed.jobId ?? null,
      remoteSessionId: parsed.remoteSessionId ?? parsed.sessionId ?? input.remoteSessionId ?? null,
      modelLabel: parsed.modelLabel ?? input.preferredModel ?? null,
      report,
    } satisfies OpenClawEvaluationResult;
  },

  async cancelJob(remoteJobId) {
    if (!remoteJobId) return;
    if (env.OPENCLAW_TRANSPORT === 'mock') return;

    await remoteRequest(`/api/window/jobs/${encodeURIComponent(remoteJobId)}/cancel`, {
      method: 'POST',
    });
  },
};

async function remoteRequest(
  path: string,
  init: {
    method: 'GET' | 'POST';
    body?: unknown;
  },
): Promise<unknown> {
  if (env.OPENCLAW_TRANSPORT === 'http') {
    return httpRequest(path, init);
  }

  if (env.OPENCLAW_TRANSPORT === 'ssh') {
    return sshRequest(path, init);
  }

  throw new Error(`Unsupported OpenClaw transport: ${env.OPENCLAW_TRANSPORT}`);
}

async function httpRequest(
  path: string,
  init: {
    method: 'GET' | 'POST';
    body?: unknown;
  },
): Promise<unknown> {
  const baseUrl = env.OPENCLAW_HTTP_BASE_URL.trim();
  if (!baseUrl) {
    throw new Error('OPENCLAW_HTTP_BASE_URL is not configured.');
  }

  const response = await fetch(`${stripTrailingSlash(baseUrl)}${path}`, {
    method: init.method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(env.OPENCLAW_API_TOKEN
        ? { Authorization: `Bearer ${env.OPENCLAW_API_TOKEN}` }
        : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  if (!response.ok) {
    throw new Error(`OpenClaw HTTP request failed with ${response.status}.`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function sshRequest(
  path: string,
  init: {
    method: 'GET' | 'POST';
    body?: unknown;
  },
): Promise<unknown> {
  if (!env.OPENCLAW_SSH_HOST || !env.OPENCLAW_SSH_USER || !env.OPENCLAW_SSH_KEY_PATH) {
    throw new Error('OpenClaw SSH transport is not fully configured.');
  }

  const url = `${stripTrailingSlash(env.OPENCLAW_REMOTE_BASE_URL)}${path}`;
  const remoteCommand = buildRemoteCurlCommand(url, init.method, init.body);
  const sshArgs = [
    '-i',
    env.OPENCLAW_SSH_KEY_PATH,
    '-o',
    'BatchMode=yes',
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'StrictHostKeyChecking=accept-new',
    `${env.OPENCLAW_SSH_USER}@${env.OPENCLAW_SSH_HOST}`,
    remoteCommand,
  ];

  const { stdout } = await execFileAsync('ssh', sshArgs, { maxBuffer: 5_000_000 });
  const output = stdout.trim();
  if (!output) {
    return null;
  }

  return JSON.parse(output) as unknown;
}

function buildRemoteCurlCommand(url: string, method: 'GET' | 'POST', body?: unknown): string {
  const parts = [
    'curl',
    '-fsSL',
    '-X',
    method,
    '-H',
    shellQuote('Accept: application/json'),
  ];

  if (method === 'POST') {
    parts.push('-H', shellQuote('Content-Type: application/json'));
  }

  if (env.OPENCLAW_API_TOKEN) {
    parts.push('-H', shellQuote(`Authorization: Bearer ${env.OPENCLAW_API_TOKEN}`));
  }

  if (body === undefined) {
    parts.push(shellQuote(url));
    return parts.join(' ');
  }

  const encodedBody = Buffer.from(JSON.stringify(body), 'utf8').toString('base64');
  parts.push('--data-binary', '@-', shellQuote(url));
  return `printf '%s' ${shellQuote(encodedBody)} | base64 --decode | ${parts.join(' ')}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizeRemoteReport(
  payload: z.infer<typeof remoteEvaluationSchema>,
  prompt: string,
): IdeaReportPayload {
  if (payload.report && typeof payload.report === 'object' && payload.report !== null) {
    const reportCandidate = payload.report as Record<string, unknown>;
    return {
      summary:
        typeof reportCandidate.summary === 'string'
          ? reportCandidate.summary
          : `OpenClaw evaluated: ${truncate(prompt, 96)}`,
      viability: normalizeViability(reportCandidate.viability),
      competitionSnapshot:
        typeof reportCandidate.competitionSnapshot === 'string'
          ? reportCandidate.competitionSnapshot
          : 'Competition snapshot was not provided by OpenClaw.',
      buildEffort:
        typeof reportCandidate.buildEffort === 'string'
          ? reportCandidate.buildEffort
          : 'Unknown',
      revenuePotential:
        typeof reportCandidate.revenuePotential === 'string'
          ? reportCandidate.revenuePotential
          : 'Unknown',
      risks: toStringArray(reportCandidate.risks),
      nextSteps: toStringArray(reportCandidate.nextSteps),
      sourceLinks: toStringArray(reportCandidate.sourceLinks),
      completedAt:
        typeof reportCandidate.completedAt === 'string'
          ? reportCandidate.completedAt
          : new Date().toISOString(),
    };
  }

  return {
    summary: payload.summary ?? `OpenClaw evaluated: ${truncate(prompt, 96)}`,
    viability: normalizeViability(payload.viability),
    competitionSnapshot:
      payload.competitionSnapshot ?? 'Competition snapshot was not provided by OpenClaw.',
    buildEffort: payload.buildEffort ?? 'Unknown',
    revenuePotential: payload.revenuePotential ?? 'Unknown',
    risks: payload.risks ?? [],
    nextSteps: payload.nextSteps ?? [],
    sourceLinks: payload.sourceLinks ?? [],
    completedAt: payload.completedAt ?? new Date().toISOString(),
  };
}

function normalizeViability(value: unknown): IdeaReportPayload['viability'] {
  return value === 'low' || value === 'moderate' || value === 'high' ? value : 'unknown';
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function buildMockReport(prompt: string): IdeaReportPayload {
  const trimmed = truncate(prompt.trim(), 140);
  return {
    summary: `Window captured "${trimmed}" and OpenClaw generated a first-pass viability review for it.`,
    viability: 'moderate',
    competitionSnapshot:
      'The space appears active enough to require differentiation, but not so saturated that a niche angle is impossible.',
    buildEffort:
      'A practical MVP would likely need a focused scope, a lightweight backend, and a narrow onboarding path.',
    revenuePotential:
      'Revenue potential looks plausible if the user segment has a recurring problem and clear willingness to pay.',
    risks: [
      'The target problem may still be too broad for a first release.',
      'Distribution could be harder than building the product itself.',
      'Validation interviews are still needed before heavy implementation.',
    ],
    nextSteps: [
      'Interview at least five target users and capture repeated pain points.',
      'Map a one-screen MVP that tests the core workflow.',
      'Compare pricing and positioning against the most obvious alternatives.',
    ],
    sourceLinks: [],
    completedAt: new Date().toISOString(),
  };
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

