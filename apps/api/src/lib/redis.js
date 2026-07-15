import Redis from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
  retryStrategy: (times) => Math.min(times * 200, 3_000),
});

redis.on('error', (err) => {
  // Redis holds live vehicle state only — a Redis outage degrades realtime to
  // schedule-only, it does not take the API down. See readiness check.
  logger.warn({ err: err.message }, 'redis connection error');
});

export async function pingRedis() {
  const res = await redis.ping();
  return res === 'PONG';
}

/** Keys are centralised so ingestion and the API can never drift apart. */
export const keys = {
  vehiclesByRoute: (regionSlug, routeId) => `veh:${regionSlug}:route:${routeId}`,
  vehicle: (regionSlug, vehicleId) => `veh:${regionSlug}:${vehicleId}`,
  feedHealth: (regionSlug) => `feed:health:${regionSlug}`,
};
