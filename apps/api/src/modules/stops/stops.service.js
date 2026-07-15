import { query } from '../../lib/db.js';
import { getRegionOrThrow, assertWithinRegion } from '../regions/regions.service.js';

/**
 * The #1 read path: "what's near me, standing at a bus stop".
 * ST_DWithin gates on the GIST index (metres, because location is geography), and
 * the `<->` operator does an index-ordered nearest-neighbour scan — ORDER BY
 * ST_Distance(...) would sort every matching row instead.
 */
export async function findNearbyStops({ region: slug, lat, lng, radius, limit }) {
  const region = await getRegionOrThrow(slug);
  await assertWithinRegion(region, lat, lng);

  const point = `SRID=4326;POINT(${lng} ${lat})`;
  const { rows } = await query(
    `SELECT s.id, s.gtfs_stop_id, s.name, s.code,
            ST_Y(s.location::geometry) AS lat,
            ST_X(s.location::geometry) AS lng,
            ROUND(ST_Distance(s.location, $1::geography))::int AS distance_m,
            COALESCE(
              (SELECT array_agg(DISTINCT r.short_name ORDER BY r.short_name)
                 FROM stop_times st
                 JOIN trips t ON t.id = st.trip_id
                 JOIN routes r ON r.id = t.route_id
                WHERE st.stop_id = s.id AND r.short_name IS NOT NULL),
              '{}'
            ) AS routes
       FROM stops s
      WHERE s.region_id = $2
        AND s.location_type = 0
        AND ST_DWithin(s.location, $1::geography, $3)
      ORDER BY s.location <-> $1::geography
      LIMIT $4`,
    [point, region.id, radius, limit],
  );

  return rows;
}

/** Autocomplete. Trigram index does the work; debounce on the client, not here. */
export async function searchStops({ region: slug, q, limit }) {
  const region = await getRegionOrThrow(slug);

  const { rows } = await query(
    `SELECT s.id, s.gtfs_stop_id, s.name, s.code,
            ST_Y(s.location::geometry) AS lat,
            ST_X(s.location::geometry) AS lng,
            similarity(s.name, $2) AS score
       FROM stops s
      WHERE s.region_id = $1
        AND s.location_type = 0
        AND s.name % $2
      ORDER BY score DESC, s.name
      LIMIT $3`,
    [region.id, q, limit],
  );

  return rows;
}
