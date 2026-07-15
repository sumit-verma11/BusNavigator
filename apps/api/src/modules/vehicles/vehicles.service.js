import { query } from '../../lib/db.js';
import { redis, keys } from '../../lib/redis.js';
import { AppError } from '../../middleware/error.js';
import { getRegionOrThrow } from '../regions/regions.service.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ module: 'vehicles' });

/**
 * Live positions, read straight from Redis (the poller owns the writes).
 *
 * This endpoint must NEVER fail loudly just because realtime is unavailable — a
 * user standing at a bus stop with a dead feed still needs the schedule. So every
 * degraded path returns 200 with `stale: true` and a reason, and the UI shows a
 * banner instead of an error screen. That is the whole contract:
 *
 *   stale=false  -> these buses are real, drawn on the map
 *   stale=true   -> feed is down/never enabled; fall back to timetable, say so
 */
export async function getLiveVehicles({ region: slug, route: routeId }) {
  const region = await getRegionOrThrow(slug);

  const { rows } = await query(
    'SELECT id, gtfs_route_id FROM routes WHERE id = $1 AND region_id = $2',
    [routeId, region.id],
  );
  if (rows.length === 0) {
    throw new AppError('Unknown route for this region', { status: 404, code: 'unknown_route' });
  }
  const gtfsRouteId = rows[0].gtfs_route_id;

  if (!region.has_realtime) {
    return staleResponse('realtime_unavailable', 'Live tracking is not available for this region');
  }

  try {
    // The poller keys vehicles by the GTFS route id (that's what the RT feed carries),
    // not our surrogate id — translate before reading.
    const ids = await redis.smembers(keys.vehiclesByRoute(slug, gtfsRouteId));
    if (ids.length === 0) {
      return { vehicles: [], stale: false, reason: null, updatedAt: new Date().toISOString() };
    }

    const raw = await redis.mget(ids.map((id) => keys.vehicle(slug, id)));
    const vehicles = raw
      .filter(Boolean) // a position can expire between SMEMBERS and MGET; that's fine
      .map((json) => JSON.parse(json));

    return { vehicles, stale: false, reason: null, updatedAt: new Date().toISOString() };
  } catch (err) {
    // Redis is down. Schedule data still works, so degrade rather than 500.
    log.warn({ err: err.message, slug, routeId }, 'live vehicle read failed — degrading to stale');
    return staleResponse('cache_unavailable', 'Live positions are temporarily unavailable');
  }
}

function staleResponse(reason, message) {
  return {
    vehicles: [],
    stale: true,
    reason,
    message,
    updatedAt: new Date().toISOString(),
  };
}
