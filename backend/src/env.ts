import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(8787),
  DATABASE_URL: z.string().min(1),
  GOOGLE_TOKENINFO_URL: z.string().url().default('https://www.googleapis.com/oauth2/v3/tokeninfo'),
  OPENCLAW_TRANSPORT: z.enum(['mock', 'ssh', 'http']).default('mock'),
  OPENCLAW_SSH_HOST: z.string().default(''),
  OPENCLAW_SSH_USER: z.string().default(''),
  OPENCLAW_SSH_KEY_PATH: z.string().default(''),
  OPENCLAW_REMOTE_BASE_URL: z.string().default('http://127.0.0.1:3000'),
  OPENCLAW_API_TOKEN: z.string().default(''),
  OPENCLAW_HTTP_BASE_URL: z.string().default(''),
  OPENCLAW_MOCK_LATENCY_MS: z.coerce.number().default(2500),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().default(5000),
});

export const env = envSchema.parse(process.env);
