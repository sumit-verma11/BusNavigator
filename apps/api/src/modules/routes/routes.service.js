import { query } from '../../lib/db.js';
import { AppError } from '../../middleware/error.js';
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

  const { rows } = await query(
    `WITH active_services AS (
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
               t.headsign,
               a.departure_time,
               b.arrival_time,
               b.stop_sequence - a.stop_sequence AS stops_between
          FROM stop_times a
          JOIN stop_times b
            ON b.trip_id = a.trip_id
           AND b.stop_sequence > a.stop_sequence   -- direction matters: A must come before B
          JOIN trips t ON t.id = a.trip_id
         WHERE a.stop_id = $2 AND b.stop_id = $3 AND t.region_id = $1
     )
     SELECT r.id,
            r.gtfs_route_id,
            r.short_name,
            r.long_name,
            r.color,
            MIN(c.stops_between)::int AS stops_between,
            (SELECT COALESCE(array_agg(d.departure_time ORDER BY d.departure_time), '{}')
               FROM (SELECT DISTINCT c2.departure_time
                       FROM connections c2
                      WHERE c2.route_id = r.id
                        AND c2.service_id IN (SELECT service_id FROM active_services)
                        AND c2.departure_time >= $5::interval
                      ORDER BY c2.departure_time
                      LIMIT 3) d) AS next_departures
       FROM connections c
       JOIN routes r ON r.id = c.route_id
      GROUP BY r.id
      ORDER BY stops_between ASC, r.short_name
      LIMIT $6`,
    [region.id, from, to, serviceDate, timeOfDay, limit],
  );

  return rows.map((r) => ({
    id: r.id,
    gtfsRouteId: r.gtfs_route_id,
    shortName: r.short_name,
    longName: r.long_name,
    color: r.color,
    stopsBetween: r.stops_between,
    nextDepartures: (r.next_departures ?? []).map(formatDeparture),
  }));
}

/** The map needs the line, not the list of points. GeoJSON straight from PostGIS. */
export async function getRouteShape(routeId) {
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
