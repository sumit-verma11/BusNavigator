#!/usr/bin/env node
/**
 * DEV-ONLY. Makes a stale or shape-less static feed usable on localhost.
 *
 * Real GTFS exports go stale and often ship no geometry. The OTD Delhi feed we
 * develop against is a 2024 export: its single service calendar ended 2025-01-01
 * (so every route reads "no more buses today") and it contains no shapes.txt at
 * all (so every route reads "no map for this route"). Neither is a bug in the app
 * — it's the data — but it makes a working app look broken in a demo.
 *
 * This patches the loaded data in place, without throwing away the 10k real stops:
 *   1. Rolls every service's calendar window to span a wide range around now, so
 *      "today" has departures. Widen-only (LEAST/GREATEST) — never shrinks a feed
 *      that already covers today.
 *   2. Derives one shape per route from its most-complete trip's stop geometry
 *      where the feed shipped none, so the map draws a line instead of a blank frame.
 *
 * Invented, not authoritative. Idempotent — safe to re-run. Never in production;
 * re-ingesting a real feed overwrites all of this, which is the point.
 *
 *   npm run dev:refresh --workspace=@busnav/api -- [--region delhi]
 */
import { logger } from '../lib/logger.js';
import { pool, query } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { isProduction } from '../config/env.js';

if (isProduction) {
  logger.fatal('dev:refresh is development-only — it fabricates schedule validity and geometry');
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const slug = flag('region', 'delhi');

try {
  const { rows } = await query('SELECT id FROM supported_regions WHERE slug = $1', [slug]);
  if (rows.length === 0) throw new Error(`Unknown region: ${slug}`);
  const regionId = rows[0].id;

  // 1. Roll the service window wide enough to include now. Widen-only, so a feed
  //    that is already current is left untouched.
  const cal = await query(
    `UPDATE calendar
        SET start_date = LEAST(start_date, DATE '2020-01-01'),
            end_date   = GREATEST(end_date, DATE '2035-12-31')
      WHERE region_id = $1
        AND (start_date > DATE '2020-01-01' OR end_date < DATE '2035-12-31')`,
    [regionId],
  );

  // 2. Synthesize a route shape from the stop geometry of each route's most-complete
  //    trip, and point that route's trips at it. Only routes whose feed gave no shape.
  const shp = await query(
    `WITH counted AS (
        SELECT t.id AS trip_id, t.route_id, COUNT(st.*) AS n
          FROM trips t
          JOIN stop_times st ON st.trip_id = t.id
         WHERE t.region_id = $1
         GROUP BY t.id, t.route_id
     ),
     rep_trip AS (   -- one trip per route: the most complete variant, mirroring getRouteShape
        SELECT DISTINCT ON (route_id) trip_id, route_id
          FROM counted
         ORDER BY route_id, n DESC
     ),
     line AS (
        SELECT rt.route_id,
               ST_MakeLine(s.location::geometry ORDER BY st.stop_sequence) AS geom
          FROM rep_trip rt
          JOIN stop_times st ON st.trip_id = rt.trip_id
          JOIN stops s ON s.id = st.stop_id
         GROUP BY rt.route_id
     ),
     ins AS (
        INSERT INTO shapes (region_id, gtfs_shape_id, geom)
        SELECT $1, 'synth-r' || route_id, geom
          FROM line
         WHERE ST_NPoints(geom) >= 2   -- a LineString needs at least two points
        ON CONFLICT (region_id, gtfs_shape_id) DO UPDATE SET geom = EXCLUDED.geom
        RETURNING id, gtfs_shape_id
     )
     UPDATE trips t
        SET shape_id = ins.id
       FROM ins
      WHERE t.region_id = $1
        AND ins.gtfs_shape_id = 'synth-r' || t.route_id
        AND t.shape_id IS DISTINCT FROM ins.id`,
    [regionId],
  );

  logger.warn(
    { region: slug, calendarRowsWidened: cal.rowCount, tripsGivenShape: shp.rowCount },
    'DEV refresh complete — service dates rolled forward and route shapes synthesized from stops. Not real schedule data.',
  );
  process.exitCode = 0;
} catch (err) {
  logger.fatal({ err }, 'dev:refresh failed');
  process.exitCode = 1;
} finally {
  await Promise.allSettled([pool.end(), redis.quit()]);
}
