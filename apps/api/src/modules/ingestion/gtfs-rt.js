import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { query } from '../../lib/db.js';
import { redis, keys } from '../../lib/redis.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { captureException } from '../../lib/monitoring.js';
import { recordPollSuccess, recordPollFailure } from './feed-health.js';

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;
const log = logger.child({ module: 'gtfs-rt' });

/**
 * Vehicle positions live in Redis, never Postgres: they are ephemeral, they are
 * written every few seconds, and losing them costs nothing (the next poll rebuilds
 * the whole picture). Writing them to Postgres would mean thousands of UPDATEs a
 * minute and a bloated table for data that is worthless 30 seconds later.
 */

/** Positions must expire on their own — a crashed poller must not leave ghost buses on the map. */
const ttlSeconds = () => Math.max(30, Math.ceil((env.GTFS_RT_POLL_INTERVAL_MS / 1000) * 3));

async function fetchFeedMessage(url, apiKey) {
  const target = new URL(url);
  const headers = {};
  if (apiKey) {
    // OTD Delhi takes the key as a query param; other agencies use a header. Send both.
    target.searchParams.set('key', apiKey);
    headers['x-api-key'] = apiKey;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(target, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`RT feed responded ${res.status} ${res.statusText}`);
    return FeedMessage.decode(new Uint8Array(await res.arrayBuffer()));
  } finally {
    clearTimeout(timeout);
  }
}

function toVehicle(entity) {
  const v = entity.vehicle;
  if (!v?.position?.latitude || !v?.position?.longitude) return null;
  return {
    id: String(v.vehicle?.id ?? entity.id),
    label: v.vehicle?.label ?? null,
    routeId: v.trip?.routeId ?? null,
    tripId: v.trip?.tripId ?? null,
    lat: v.position.latitude,
    lng: v.position.longitude,
    bearing: v.position.bearing ?? null,
    speed: v.position.speed ?? null,
    timestamp: Number(v.timestamp ?? 0) || Math.floor(Date.now() / 1000),
  };
}

/** One poll cycle. Returns the vehicle count; throws only on unrecoverable errors. */
export async function pollOnce({ regionSlug = 'delhi', url, apiKey } = {}) {
  const feedUrl = url ?? env.GTFS_RT_VEHICLE_POSITIONS_URL;
  if (!feedUrl) throw new Error('GTFS_RT_VEHICLE_POSITIONS_URL is not configured');

  const { rows } = await query('SELECT id FROM supported_regions WHERE slug = $1', [regionSlug]);
  const region = rows[0];
  if (!region) throw new Error(`Unknown region: ${regionSlug}`);

  try {
    const feed = await fetchFeedMessage(feedUrl, apiKey ?? env.GTFS_RT_API_KEY);
    const vehicles = (feed.entity ?? []).map(toVehicle).filter(Boolean);

    const ttl = ttlSeconds();
    const routeMembers = new Map();
    const pipeline = redis.pipeline();

    for (const v of vehicles) {
      pipeline.set(keys.vehicle(regionSlug, v.id), JSON.stringify(v), 'EX', ttl);
      if (v.routeId) {
        if (!routeMembers.has(v.routeId)) routeMembers.set(v.routeId, []);
        routeMembers.get(v.routeId).push(v.id);
      }
    }

    // Rebuild each route's member set from scratch — a vehicle that finished its
    // trip must disappear from the route, and SADD alone would never remove it.
    for (const [routeId, vehicleIds] of routeMembers) {
      const key = keys.vehiclesByRoute(regionSlug, routeId);
      pipeline.del(key);
      pipeline.sadd(key, ...vehicleIds);
      pipeline.expire(key, ttl);
    }

    await pipeline.exec();
    await recordPollSuccess(region.id, vehicles.length);

    log.debug({ regionSlug, vehicles: vehicles.length }, 'rt poll ok');
    return { vehicleCount: vehicles.length, vehicles };
  } catch (err) {
    const { failures, disabled } = await recordPollFailure(region.id, err);
    return { vehicleCount: 0, error: err.message, failures, disabled };
  }
}

/** Cap the backoff: beyond a few minutes we're just idling, and the feed may return any moment. */
const MAX_BACKOFF_MS = 5 * 60_000;

/**
 * Exponential backoff with jitter, applied only while the feed is failing.
 *
 * Hammering a struggling upstream every 10s makes its outage worse and gets us
 * rate-limited — and the jitter matters because without it every restarted poller
 * in every environment retries in lockstep, arriving as a thundering herd exactly
 * when the feed is trying to come back up.
 */
export function nextPollDelay(failures, baseMs, { random = Math.random } = {}) {
  if (failures <= 0) return baseMs; // healthy: keep the steady cadence

  const backoff = Math.min(baseMs * 2 ** failures, MAX_BACKOFF_MS);
  const jitter = backoff * 0.2 * random(); // up to +20%
  return Math.round(backoff + jitter);
}

/**
 * Long-running poller. Errors are absorbed by pollOnce (and surfaced through
 * feed_health), so the loop itself must never die — a dead poller is the failure
 * mode this whole design exists to prevent.
 */
export function startPoller({
  regionSlug = 'delhi',
  intervalMs = env.GTFS_RT_POLL_INTERVAL_MS,
} = {}) {
  let stopped = false;
  let timer;
  let failures = 0;

  const tick = async () => {
    if (stopped) return;

    try {
      const result = await pollOnce({ regionSlug });
      // pollOnce resolves either way; `error` is how it reports a failed poll.
      failures = result.error ? failures + 1 : 0;
    } catch (err) {
      // Genuinely unexpected (e.g. Postgres unreachable). Back off, stay alive.
      failures += 1;
      captureException(err, { module: 'gtfs-rt', regionSlug, failures });
      log.error({ err, failures }, 'poller tick threw — continuing');
    }

    if (!stopped) {
      const delay = nextPollDelay(failures, intervalMs);
      if (failures > 0) log.warn({ regionSlug, failures, delay }, 'backing off');
      timer = setTimeout(tick, delay);
    }
  };

  log.info({ regionSlug, intervalMs }, 'rt poller started');
  tick();

  return function stop() {
    stopped = true;
    clearTimeout(timer);
    log.info({ regionSlug }, 'rt poller stopped');
  };
}
