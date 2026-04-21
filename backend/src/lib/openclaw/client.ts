import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { env } from '../../env.js';
import type {
  AssistantTaskStatus,
  IdeaReportPayload,
} from '../../types.js';
import { prisma } from '../prisma.js';

const execFileAsync = promisify(execFile);
const PRIMARY_CONNECTOR_KEY = 'primary-openclaw';

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

const remoteTaskCreateSchema = z
  .object({
    remoteJobId: z.string().nullable().optional(),
    jobId: z.string().nullable().optional(),
    remoteSessionId: z.string().nullable().optional(),
    sessionId: z.string().nullable().optional(),
    modelLabel: z.string().nullable().optional(),
    title: z.string().optional(),
  })
  .partial();

const remoteTaskStatusSchema = z
  .object({
    status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']).optional(),
    error: z.string().nullable().optional(),
    remoteSessionId: z.string().nullable().optional(),
    sessionId: z.string().nullable().optional(),
    modelLabel: z.string().nullable().optional(),
    result: z
      .object({
        summary: z.string().optional(),
        output: z.string().optional(),
        completedAt: z.string().optional(),
      })
      .partial()
      .optional(),
    summary: z.string().optional(),
    output: z.string().optional(),
    completedAt: z.string().optional(),
  })
  .partial();

export interface OpenClawConnectionConfig {
  id: string;
  key: string;
  name: string;
  transport: string;
  host: string | null;
  baseUrl: string | null;
  description: string | null;
  enabled: boolean;
}

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

export interface OpenClawTaskCreateInput {
  prompt: string;
  preferredModel?: string | null;
  notes?: string | null;
  remoteSessionId?: string | null;
  title?: string | null;
}

export interface OpenClawTaskCreateResult {
  remoteJobId: string | null;
  remoteSessionId: string | null;
  modelLabel: string | null;
  title: string;
}

export interface OpenClawTaskStatusResult {
  status: AssistantTaskStatus;
  remoteSessionId: string | null;
  modelLabel: string | null;
  summary: string | null;
  output: string | null;
  completedAt: string | null;
  error: string | null;
}

export interface OpenClawConnector {
  syncConnectionRecord(): Promise<void>;
  getAvailableConnections(): Promise<OpenClawConnectionConfig[]>;
  getStatus(connection: OpenClawConnectionConfig): Promise<OpenClawStatus>;
  createSession(
    connection: OpenClawConnectionConfig,
    input: { title: string; preferredModel?: string | null },
  ): Promise<OpenClawSessionCreateResult>;
  evaluateIdea(
    connection: OpenClawConnectionConfig,
    input: OpenClawEvaluationInput,
  ): Promise<OpenClawEvaluationResult>;
  createTask(
    connection: OpenClawConnectionConfig,
    input: OpenClawTaskCreateInput,
  ): Promise<OpenClawTaskCreateResult>;
  getTaskStatus(
    connection: OpenClawConnectionConfig,
    remoteJobId: string,
  ): Promise<OpenClawTaskStatusResult>;
  cancelJob(connection: OpenClawConnectionConfig, remoteJobId: string | null): Promise<void>;
  cancelTask(connection: OpenClawConnectionConfig, remoteJobId: string | null): Promise<void>;
}

export const openClawConnector: OpenClawConnector = {
  async syncConnectionRecord() {
    const transport = env.OPENCLAW_TRANSPORT;
    const host = transport === 'ssh' ? env.OPENCLAW_SSH_HOST || null : null;
    const baseUrl =
      transport === 'http'
        ? env.OPENCLAW_HTTP_BASE_URL || null
        : env.OPENCLAW_REMOTE_BASE_URL || null;

    const existing = await prisma.openClawConnection.findUnique({
      where: { key: PRIMARY_CONNECTOR_KEY },
      select: { id: true },
    });

    if (existing) {
      await prisma.openClawConnection.update({
        where: { id: existing.id },
        data: {
          name: 'Primary OpenClaw',
          connectorType: 'openclaw',
          transport,
          host,
          baseUrl,
          description: 'Oracle-hosted OpenClaw',
          enabled: true,
        },
      });
      return;
    }

    await prisma.openClawConnection.create({
      data: {
        key: PRIMARY_CONNECTOR_KEY,
        name: 'Primary OpenClaw',
        connectorType: 'openclaw',
        transport,
        host,
        baseUrl,
        description: 'Oracle-hosted OpenClaw',
        enabled: true,
      },
    });
  },

  async getAvailableConnections() {
    await this.syncConnectionRecord();
    const rows = await prisma.openClawConnection.findMany({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      transport: row.transport,
      host: row.host,
      baseUrl: row.baseUrl,
      description: row.description,
      enabled: row.enabled,
    }));
  },

  async getStatus(connection) {
    const now = new Date().toISOString();

    if (connection.transport === 'mock') {
      return {
        connected: true,
        healthy: true,
        transport: 'unknown',
        label: connection.name,
        message: 'Mock transport is enabled for local development.',
        lastCheckedAt: now,
      } satisfies OpenClawStatus;
    }

    try {
      const response = await remoteRequest(connection, '/api/window/health', { method: 'GET' });
      const parsed = remoteHealthSchema.parse(response);

      return {
        connected: parsed.connected ?? true,
        healthy: parsed.healthy ?? true,
        transport: normalizeTransport(connection.transport),
        label: parsed.label ?? connection.name,
        message: parsed.message ?? 'OpenClaw is reachable.',
        lastCheckedAt: now,
      } satisfies OpenClawStatus;
    } catch (error) {
      return {
        connected: false,
        healthy: false,
        transport: normalizeTransport(connection.transport),
        label: connection.name,
        message: error instanceof Error ? error.message : String(error),
        lastCheckedAt: now,
      } satisfies OpenClawStatus;
    }
  },

  async createSession(connection, { title, preferredModel }) {
    if (connection.transport === 'mock') {
      return {
        remoteSessionId: `mock-session-${randomUUID()}`,
        title,
        modelLabel: preferredModel?.trim() || 'Mock OpenClaw model',
      } satisfies OpenClawSessionCreateResult;
    }

    const response = await remoteRequest(connection, '/api/window/sessions', {
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

  async evaluateIdea(connection, input) {
    if (connection.transport === 'mock') {
      await sleep(env.OPENCLAW_MOCK_LATENCY_MS);
      const remoteSessionId = input.remoteSessionId ?? `mock-session-${randomUUID()}`;
      return {
        remoteJobId: `mock-job-${randomUUID()}`,
        remoteSessionId,
        modelLabel: input.preferredModel?.trim() || 'Mock OpenClaw model',
        report: buildMockReport(input.prompt),
      } satisfies OpenClawEvaluationResult;
    }

    const response = await remoteRequest(connection, '/api/window/ideas/evaluate', {
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

  async createTask(connection, input) {
    if (connection.transport === 'mock') {
      return {
        remoteJobId: `mock-task-${randomUUID()}`,
        remoteSessionId: input.remoteSessionId ?? `mock-session-${randomUUID()}`,
        modelLabel: input.preferredModel?.trim() || 'Mock OpenClaw model',
        title: input.title?.trim() || buildTaskTitle(input.prompt),
      } satisfies OpenClawTaskCreateResult;
    }

    const response = await remoteRequest(connection, '/api/window/tasks', {
      method: 'POST',
      body: {
        prompt: input.prompt,
        preferredModel: input.preferredModel?.trim() || undefined,
        notes: input.notes?.trim() || undefined,
        sessionId: input.remoteSessionId ?? undefined,
        title: input.title?.trim() || undefined,
      },
    });
    const parsed = remoteTaskCreateSchema.parse(response);

    return {
      remoteJobId: parsed.remoteJobId ?? parsed.jobId ?? null,
      remoteSessionId: parsed.remoteSessionId ?? parsed.sessionId ?? input.remoteSessionId ?? null,
      modelLabel: parsed.modelLabel ?? input.preferredModel ?? null,
      title: parsed.title ?? input.title?.trim() ?? buildTaskTitle(input.prompt),
    } satisfies OpenClawTaskCreateResult;
  },

  async getTaskStatus(connection, remoteJobId) {
    if (connection.transport === 'mock') {
      return {
        status: 'completed',
        remoteSessionId: `mock-session-${remoteJobId}`,
        modelLabel: 'Mock OpenClaw model',
        summary: 'Mock task finished',
        output: 'Mock OpenClaw completed the handoff task successfully.',
        completedAt: new Date().toISOString(),
        error: null,
      } satisfies OpenClawTaskStatusResult;
    }

    const response = await remoteRequest(
      connection,
      `/api/window/tasks/${encodeURIComponent(remoteJobId)}`,
      { method: 'GET' },
    );
    const parsed = remoteTaskStatusSchema.parse(response);
    const result = parsed.result ?? {};

    return {
      status: parsed.status ?? 'running',
      remoteSessionId: parsed.remoteSessionId ?? parsed.sessionId ?? null,
      modelLabel: parsed.modelLabel ?? null,
      summary: result.summary ?? parsed.summary ?? null,
      output: result.output ?? parsed.output ?? null,
      completedAt: result.completedAt ?? parsed.completedAt ?? null,
      error: parsed.error ?? null,
    } satisfies OpenClawTaskStatusResult;
  },

  async cancelJob(connection, remoteJobId) {
    if (!remoteJobId) return;
    if (connection.transport === 'mock') return;

    await remoteRequest(
      connection,
      `/api/window/jobs/${encodeURIComponent(remoteJobId)}/cancel`,
      { method: 'POST' },
    );
  },

  async cancelTask(connection, remoteJobId) {
    if (!remoteJobId) return;
    if (connection.transport === 'mock') return;

    await remoteRequest(
      connection,
      `/api/window/tasks/${encodeURIComponent(remoteJobId)}/cancel`,
      { method: 'POST' },
    );
  },
};

async function remoteRequest(
  connection: OpenClawConnectionConfig,
  path: string,
  init: {
    method: 'GET' | 'POST';
    body?: unknown;
  },
): Promise<unknown> {
  if (connection.transport === 'http') {
    return httpRequest(connection, path, init);
  }

  if (connection.transport === 'ssh') {
    return sshRequest(connection, path, init);
  }

  throw new Error(`Unsupported OpenClaw transport: ${connection.transport}`);
}

async function httpRequest(
  connection: OpenClawConnectionConfig,
  path: string,
  init: {
    method: 'GET' | 'POST';
    body?: unknown;
  },
): Promise<unknown> {
  const baseUrl = (connection.baseUrl ?? '').trim();
  if (!baseUrl) {
    throw new Error('OpenClaw HTTP transport is missing a base URL.');
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
  connection: OpenClawConnectionConfig,
  path: string,
  init: {
    method: 'GET' | 'POST';
    body?: unknown;
  },
): Promise<unknown> {
  if (!connection.host || !env.OPENCLAW_SSH_USER || !env.OPENCLAW_SSH_KEY_PATH) {
    throw new Error('OpenClaw SSH transport is not fully configured.');
  }

  const baseUrl = (connection.baseUrl ?? '').trim();
  if (!baseUrl) {
    throw new Error('OpenClaw SSH transport is missing a remote base URL.');
  }

  const url = `${stripTrailingSlash(baseUrl)}${path}`;
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
    `${env.OPENCLAW_SSH_USER}@${connection.host}`,
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

function normalizeTransport(value: string): OpenClawStatus['transport'] {
  if (value === 'ssh' || value === 'http') {
    return value;
  }

  return 'unknown';
}

function normalizeViability(value: unknown): IdeaReportPayload['viability'] {
  return value === 'low' || value === 'moderate' || value === 'high' ? value : 'unknown';
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
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

function buildTaskTitle(prompt: string): string {
  return `Task handoff: ${truncate(prompt.trim(), 48)}`;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
