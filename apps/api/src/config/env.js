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

  // PEM-encoded CA certificate for providers whose Postgres cert isn't signed by a
  // publicly trusted root (common with a managed provider's default cert). Leave
  // unset when the provider uses a publicly trusted cert (Node's default trust
  // store already verifies those).
  DATABASE_SSL_CA: z.string().optional(),
  // Escape hatch only. Silently trusting any certificate defeats the point of TLS —
  // this must be an explicit, loud opt-in (and logged, see db.js), never a default.
  DATABASE_SSL_REJECT_UNAUTHORIZED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  GTFS_STATIC_URL: z.string().url().optional(),
  GTFS_RT_VEHICLE_POSITIONS_URL: z.string().url().optional(),
  GTFS_RT_API_KEY: z.string().optional(),
  GTFS_RT_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).default(10_000),
  GTFS_RT_FAILURE_THRESHOLD: z.coerce.number().int().min(1).default(5),

  // When a direct search on the exact picked stop finds nothing, we retry over
  // stops within this radius and tell the user which nearby stop the bus actually
  // leaves from. GTFS splits one physical place ("Azadpur") into many stop ids
  // (platforms, directions, terminals) and a newcomer picks by name, not id — so
  // the buses are usually a short walk away, not absent. 800m is the classic
  // half-mile transit walkshed; it's surfaced to the user as an exact distance,
  // never a hidden merge.
  ROUTE_FALLBACK_RADIUS_M: z.coerce.number().int().positive().default(800),

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
