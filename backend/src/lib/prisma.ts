import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma runs through the `pg` driver adapter in every runtime. A Cloudflare
 * Worker cannot reuse sockets across requests, so the Worker entrypoint scopes
 * one client to each invocation with `withPrismaClient`; Node processes fall
 * back to a single shared client.
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: ['warn', 'error'],
  });
}

const scopedClient = new AsyncLocalStorage<PrismaClient>();
let sharedClient: PrismaClient | undefined;

export function withPrismaClient<T>(client: PrismaClient, run: () => Promise<T>): Promise<T> {
  return scopedClient.run(client, run);
}

function currentClient(): PrismaClient {
  const scoped = scopedClient.getStore();
  if (scoped) return scoped;

  if (!sharedClient) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not configured.');
    }
    sharedClient = createPrismaClient(connectionString);
  }
  return sharedClient;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = currentClient();
    const value = Reflect.get(client, property, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
