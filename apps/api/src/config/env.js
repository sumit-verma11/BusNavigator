import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// The ONLY module in the codebase allowed to touch process.env.
// Everything else imports `env` from here — that is what makes config swappable
// per environment instead of hardcoded at call sites.
//
// The .env lives at the repo root, so resolve it from this file rather than cwd:
// npm workspace scripts run with cwd=apps/api and would otherwise miss it.
// Real env vars still win over the file, which is what CI and prod rely on.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
loadDotenv({ path: path.join(repoRoot, '.env') });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  GTFS_STATIC_URL: z.string().url().optional(),
  GTFS_RT_VEHICLE_POSITIONS_URL: z.string().url().optional(),
  GTFS_RT_API_KEY: z.string().optional(),
  GTFS_RT_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).default(10_000),
  GTFS_RT_FAILURE_THRESHOLD: z.coerce.number().int().min(1).default(5),

  SENTRY_DSN: z.string().url().optional(),

  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
});

// An env var set to "" means "not configured", not "configured as empty string" —
// otherwise a blank GTFS_STATIC_URL in .env fails url validation instead of
// falling through to .optional(). Drop empties before validating.
const present = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ''));

const parsed = schema.safeParse(present);

if (!parsed.success) {
  // Fail loudly at boot rather than throwing undefined-shaped errors at 3am.
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = Object.freeze(parsed.data);
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
