import { Router } from 'express';
import { pingDb, query } from '../../lib/db.js';
import { pingRedis } from '../../lib/redis.js';
import { env } from '../../config/env.js';

export const healthRouter = Router();

/**
 * Liveness: "is the process up?" — must not touch dependencies, or a slow DB
 * will get the container killed by the orchestrator for no reason.
 */
healthRouter.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

/**
 * Readiness: "should this instance receive traffic?" — Postgres is required,
 * Redis is degraded-but-serveable (schedule data still works without live positions).
 */
healthRouter.get('/readyz', async (_req, res) => {
  const [db, cache] = await Promise.allSettled([pingDb(), pingRedis()]);

  const checks = {
    postgres: db.status === 'fulfilled' && db.value ? 'ok' : 'down',
    redis: cache.status === 'fulfilled' && cache.value ? 'ok' : 'down',
  };

  const ready = checks.postgres === 'ok';
  const status = ready ? (checks.redis === 'ok' ? 'ok' : 'degraded') : 'down';

  res.status(ready ? 200 : 503).json({ status, checks });
});

/**
 * POINT YOUR UPTIME MONITOR AT THIS.
 *
 * The API can be perfectly healthy — /healthz green, /readyz green — while the
 * realtime poller has been dead for six hours and every user is quietly looking at
 * a timetable. Nothing else in the system notices. This endpoint does: it goes 503
 * when a region that is supposed to have realtime hasn't had a successful poll
 * within a generous multiple of its poll interval.
 *
 * A region with realtime switched off is NOT unhealthy — it's a region we never
 * promised live data for. Only a *broken promise* is an alert.
 */
healthRouter.get('/healthz/feeds', async (_req, res) => {
  // 20x the poll interval: long enough to ride out a few retries and the backoff,
  // short enough that a genuinely dead poller pages someone the same morning.
  const staleAfterMs = env.GTFS_RT_POLL_INTERVAL_MS * 20;

  const { rows } = await query(
    `SELECT r.slug,
            r.has_realtime,
            fh.last_success_at,
            fh.consecutive_failures,
            fh.vehicle_count,
            fh.last_error,
            EXTRACT(EPOCH FROM (now() - fh.last_success_at)) * 1000 AS since_success_ms
       FROM supported_regions r
       LEFT JOIN feed_health fh ON fh.region_id = r.id
      WHERE r.is_active
      ORDER BY r.slug`,
  );

  const feeds = rows.map((row) => {
    const sinceSuccess = row.since_success_ms == null ? null : Number(row.since_success_ms);
    const stalled = row.has_realtime && (sinceSuccess == null || sinceSuccess > staleAfterMs);

    return {
      region: row.slug,
      realtimeEnabled: row.has_realtime,
      healthy: !stalled,
      lastSuccessAt: row.last_success_at,
      secondsSinceSuccess: sinceSuccess == null ? null : Math.round(sinceSuccess / 1000),
      consecutiveFailures: row.consecutive_failures ?? 0,
      vehicleCount: row.vehicle_count ?? 0,
      lastError: row.last_error,
    };
  });

  const unhealthy = feeds.filter((f) => !f.healthy);

  res.status(unhealthy.length > 0 ? 503 : 200).json({
    status: unhealthy.length > 0 ? 'degraded' : 'ok',
    staleAfterSeconds: Math.round(staleAfterMs / 1000),
    feeds,
  });
});
