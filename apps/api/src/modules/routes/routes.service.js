import { query } from '../../lib/db.js';
import { AppError } from '../../middleware/error.js';
import { env } from '../../config/env.js';
import { getRegionOrThrow } from '../regions/regions.service.js';
import { formatDeparture, toDayInterval } from '../../lib/gtfs-time.js';

/**
 * v1 is DIRECT routes only — trips that call at `from` and later call at `to`.
 * No interchanges, deliberately (see ARCHITECTURE.md §5): multi-leg routing is a
 * different, much more expensive problem and nobody has asked for it yet.
 *
 * Two separate questions get separate answers, because the UI needs to tell them
 * apart: (a) does a route connect these stops at all, and (b) is a bus actually
 * coming today? A route with no remaining departures still appears, with an empty
 * `nextDepartures` — that's "last bus has gone", not "no such route".
 *
 * A third question hides inside (a): GTFS splits one physical place into many stop
 * ids (platforms, directions, terminals), and a newcomer searches by *name*, not
 * id — so they often pick the roadside "Azadpur" when every bus leaves from
 * "Azadpur Terminal" 300m away. When the exact pair finds nothing, we widen the
 * search to stops within walking distance and report which stop the bus actually
 * uses (`boardAt` / `alightAt`), rather than lying that no bus exists.
 */
export async function searchDirectRoutes(
  { region: slug, from, to, limit },
  { now = new Date() } = {},
) {
  const region = await getRegionOrThrow(slug);

  if (from === to) {
    throw new AppError('Origin and destination must differ', {
      status: 422,
      code: 'same_stop',
    });
  }

  await assertStopsInRegion(region, [from, to]);

  // "Now" in the region's own timezone — a Delhi bus schedule has no opinion about
  // where the server happens to be running. Injectable so tests can pin the clock
  // instead of quietly breaking whenever CI runs late at night.
  const localNow = new Date(
    now.toLocaleString('en-US', { timeZone: region.timezone ?? 'Asia/Kolkata' }),
  );
  const serviceDate = localNow.toISOString().slice(0, 10);
  const timeOfDay = toDayInterval(localNow);
  const ctx = { region, from, to, serviceDate, timeOfDay, limit };

  // Exact stops first: precise, and the common case. Only widen if it comes up empty.
  const exact = await runConnectionQuery(ctx, [from], [to]);
  if (exact.length > 0) return exact.map((r) => mapRoute(r));

  // Fallback: expand each endpoint to stops within walking distance and match
  // any-to-any. The picked stop is included (distance 0), so a route that leaves
  // from the exact stop still ranks first if it exists.
  const [fromIds, toIds] = await Promise.all([
    nearbyStopIds(region.id, from, env.ROUTE_FALLBACK_RADIUS_M),
    nearbyStopIds(region.id, to, env.ROUTE_FALLBACK_RADIUS_M),
  ]);
  const nearby = await runConnectionQuery(ctx, fromIds, toIds);
  return nearby.map((r) => mapRoute(r));
}

/** Boardable stop ids within `radius` metres of a picked stop, itself included. */
async function nearbyStopIds(regionId, stopId, radius) {
  const { rows } = await query(
    `SELECT s.id
       FROM stops s
       JOIN stops picked ON picked.id = $2 AND picked.region_id = $1
      WHERE s.region_id = $1
        AND s.location_type = 0
        AND ST_DWithin(s.location, picked.location, $3)`,
    [regionId, stopId, radius],
  );
  return rows.map((r) => r.id);
}

/**
 * Routes whose trips call at some `fromIds` stop and later at some `toIds` stop.
 * Per route we keep the boarding/alighting pair with the shortest total walk from
 * the stops the user actually picked, and read `next_departures` off that same
 * pair so the times match the stop we name.
 */
async function runConnectionQuery(ctx, fromIds, toIds) {
  const { region, from, to, serviceDate, timeOfDay, limit } = ctx;
  const { rows } = await query(
    `WITH from_cand AS (
        SELECT s.id, ST_Distance(s.location, pf.location)::int AS dist
          FROM stops s
          JOIN stops pf ON pf.id = $7 AND pf.region_id = $1
         WHERE s.id = ANY($2::int[]) AND s.region_id = $1
     ),
     to_cand AS (
        SELECT s.id, ST_Distance(s.location, pt.location)::int AS dist
          FROM stops s
          JOIN stops pt ON pt.id = $8 AND pt.region_id = $1
         WHERE s.id = ANY($3::int[]) AND s.region_id = $1
     ),
     active_services AS (
        SELECT service_id FROM calendar
          WHERE region_id = $1
            AND $4::date BETWEEN start_date AND end_date
            AND (CASE EXTRACT(ISODOW FROM $4::date)
                   WHEN 1 THEN monday WHEN 2 THEN tuesday WHEN 3 THEN wednesday
                   WHEN 4 THEN thursday WHEN 5 THEN friday WHEN 6 THEN saturday
                   ELSE sunday END)
        UNION
        SELECT service_id FROM calendar_dates
          WHERE region_id = $1 AND date = $4::date AND exception_type = 1
        EXCEPT
        SELECT service_id FROM calendar_dates
          WHERE region_id = $1 AND date = $4::date AND exception_type = 2
     ),
     connections AS (
        SELECT t.route_id,
               t.service_id,
               a.stop_id AS from_stop,
               b.stop_id AS to_stop,
               fc.dist   AS from_dist,
               tc.dist   AS to_dist,
               a.departure_time,
               b.stop_sequence - a.stop_sequence AS stops_between
          FROM stop_times a
          JOIN stop_times b
            ON b.trip_id = a.trip_id
           AND b.stop_sequence > a.stop_sequence   -- direction matters: A must come before B
          JOIN trips t ON t.id = a.trip_id
          JOIN from_cand fc ON fc.id = a.stop_id
          JOIN to_cand tc ON tc.id = b.stop_id
         WHERE t.region_id = $1
     ),
     rep AS (   -- one boarding/alighting pair per route: least walking, then fewest stops
        SELECT DISTINCT ON (route_id)
               route_id, from_stop, to_stop, from_dist, to_dist
          FROM connections
         ORDER BY route_id, (from_dist + to_dist) ASC, stops_between ASC
     )
     SELECT r.id,
            r.gtfs_route_id,
            r.short_name,
            r.long_name,
            r.color,
            rep.from_dist,
            rep.to_dist,
            sf.name AS board_name,
            sa.name AS alight_name,
            (SELECT MIN(c.stops_between)::int
               FROM connections c
              WHERE c.route_id = rep.route_id
                AND c.from_stop = rep.from_stop
                AND c.to_stop = rep.to_stop) AS stops_between,
            (SELECT COALESCE(array_agg(d.departure_time ORDER BY d.departure_time), '{}')
               FROM (SELECT DISTINCT c2.departure_time
                       FROM connections c2
                      WHERE c2.route_id = rep.route_id
                        AND c2.from_stop = rep.from_stop
                        AND c2.to_stop = rep.to_stop
                        AND c2.service_id IN (SELECT service_id FROM active_services)
                        AND c2.departure_time >= $5::interval
                      ORDER BY c2.departure_time
                      LIMIT 3) d) AS next_departures
       FROM rep
       JOIN routes r ON r.id = rep.route_id
       JOIN stops sf ON sf.id = rep.from_stop
       JOIN stops sa ON sa.id = rep.to_stop
      ORDER BY (rep.from_dist + rep.to_dist) ASC, stops_between ASC, r.short_name
      LIMIT $6`,
    [region.id, fromIds, toIds, serviceDate, timeOfDay, limit, from, to],
  );
  return rows;
}

function mapRoute(r) {
  return {
    id: r.id,
    gtfsRouteId: r.gtfs_route_id,
    shortName: r.short_name,
    longName: r.long_name,
    color: r.color,
    stopsBetween: r.stops_between,
    // Only set when the bus uses a *different* stop than the one picked — i.e. the
    // fallback fired. Distance 0 means "your exact stop", so we say nothing.
    boardAt: r.from_dist > 0 ? { name: r.board_name, distanceM: r.from_dist } : null,
    alightAt: r.to_dist > 0 ? { name: r.alight_name, distanceM: r.to_dist } : null,
    nextDepartures: (r.next_departures ?? []).map(formatDeparture),
  };
}

/**
 * The map needs the line, not the list of points. GeoJSON straight from PostGIS.
 *
 * Scoped by region like every other lookup here (GTFS ids, and therefore surrogate
 * route ids, only ever mean something within their own feed) — a route id from one
 * region must not return another region's shape just because ids are sequential.
 */
export async function getRouteShape(regionSlug, routeId) {
  const region = await getRegionOrThrow(regionSlug);

  const { rows: routeRows } = await query(
    'SELECT id FROM routes WHERE id = $1 AND region_id = $2',
    [routeId, region.id],
  );
  if (routeRows.length === 0) {
    throw new AppError('Unknown route for this region', { status: 404, code: 'unknown_route' });
  }

  const { rows } = await query(
    `SELECT r.id, r.short_name,
            ST_AsGeoJSON(sh.geom)::json AS geometry
       FROM routes r
       JOIN trips t ON t.route_id = r.id
       JOIN shapes sh ON sh.id = t.shape_id
      WHERE r.id = $1
      ORDER BY ST_NPoints(sh.geom) DESC   -- the most complete variant of the route
      LIMIT 1`,
    [routeId],
  );

  if (rows.length === 0) {
    throw new AppError('No shape available for this route', {
      status: 404,
      code: 'shape_not_found',
    });
  }

  return {
    routeId: rows[0].id,
    shortName: rows[0].short_name,
    geometry: rows[0].geometry, // GeoJSON LineString — drop straight into the map layer
  };
}

async function assertStopsInRegion(region, stopIds) {
  const { rows } = await query(
    'SELECT COUNT(*)::int AS n FROM stops WHERE region_id = $1 AND id = ANY($2::int[])',
    [region.id, stopIds],
  );
  if (rows[0].n !== stopIds.length) {
    throw new AppError('One or both stops do not exist in this region', {
      status: 404,
      code: 'unknown_stop',
    });
  }
}
