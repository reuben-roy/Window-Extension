import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import manifest from '../manifest.json';

const DEPLOYED_BACKEND_URL = 'https://api.window.explosion.fun';

describe('production backend configuration', () => {
  it('builds the extension against the deployed backend', () => {
    const envFile = readFileSync(path.resolve(process.cwd(), '.env.production'), 'utf8');
    const configuredUrl = envFile
      .split(/\r?\n/)
      .find((line) => line.startsWith('VITE_WINDOW_BACKEND_URL='))
      ?.slice('VITE_WINDOW_BACKEND_URL='.length)
      .trim();

    expect(configuredUrl).toBe(DEPLOYED_BACKEND_URL);
    expect(manifest.host_permissions).toContain('<all_urls>');
  });
});
