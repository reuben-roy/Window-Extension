import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { FastifyInstance } from 'fastify';

describe('backend root route', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      'postgresql://window:window@127.0.0.1:5432/window?schema=public';
    const { buildApp } = await import('../backend/src/app');
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('describes the API instead of returning a 404', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      service: 'window-backend',
      health: '/healthz',
    });
  });
});
