import type { PrismaClient } from '@prisma/client';

/** Requests that can queue background work; a successful one wakes the job processor. */
const JOB_ENQUEUING_ROUTES: readonly RegExp[] = [
  /^\/v1\/ideas$/,
  /^\/v1\/ideas\/[^/]+\/retry$/,
  /^\/v1\/assistant-tasks$/,
  /^\/v1\/learning\/user-topics$/,
  /^\/v1\/learning\/topics\/custom$/,
  /^\/v1\/learning\/packs\/[^/]+\/regenerate$/,
];

export function enqueuesJobs(method: string, pathname: string): boolean {
  return method !== 'GET' && JOB_ENQUEUING_ROUTES.some((route) => route.test(pathname));
}

/** Copies string bindings (vars and secrets) into process.env, which env.ts validates. */
export function populateProcessEnv(
  bindings: Record<string, unknown>,
  target: NodeJS.ProcessEnv = process.env,
): void {
  for (const [key, value] of Object.entries(bindings)) {
    if (typeof value === 'string') target[key] = value;
  }
}

export interface FetchDependencies {
  /** Hands the request to the Node HTTP server that hosts the Fastify app. */
  dispatch(request: Request): Promise<Response>;
  createClient(): PrismaClient;
  runWithClient<T>(client: PrismaClient, run: () => Promise<T>): Promise<T>;
  /** Wakes the job processor; failures must not affect the response. */
  kickJobs(): Promise<void>;
  waitUntil(promise: Promise<unknown>): void;
  log(fields: Record<string, unknown>): void;
}

/**
 * Serves one request with a database client scoped to it, then wakes the job
 * processor when the request may have queued work.
 */
export async function handleFetch(request: Request, deps: FetchDependencies): Promise<Response> {
  const started = Date.now();
  const url = new URL(request.url);
  const client = deps.createClient();

  try {
    const response = await deps.runWithClient(client, () => deps.dispatch(request));

    if (response.status < 300 && enqueuesJobs(request.method, url.pathname)) {
      deps.waitUntil(
        deps.kickJobs().catch((error) => deps.log({ msg: 'job kick failed', err: String(error) })),
      );
    }

    deps.log({
      msg: 'request',
      method: request.method,
      path: url.pathname,
      status: response.status,
      durationMs: Date.now() - started,
    });
    return response;
  } finally {
    deps.waitUntil(client.$disconnect().catch(() => undefined));
  }
}
