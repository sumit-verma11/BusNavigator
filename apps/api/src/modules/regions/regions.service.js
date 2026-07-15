import { query } from '../../lib/db.js';
import { AppError } from '../../middleware/error.js';

export async function listRegions() {
  // `has_data` is the honest bit: a region row means "we support this city", not
  // "we have its timetable". Without it the UI would happily show Bengaluru with an
  // empty stop list, and the user would conclude the app is broken (or that
  // Bengaluru has no buses). Derived from the data, so it can never drift out of
  // sync with reality the way a hand-maintained boolean would.
  const { rows } = await query(
    `SELECT r.slug, r.state, r.city, r.timezone, r.has_realtime,
            ST_AsGeoJSON(r.bbox)::json AS bbox,
            EXISTS (SELECT 1 FROM stops s WHERE s.region_id = r.id) AS has_data
       FROM supported_regions r
      WHERE r.is_active
      ORDER BY r.state, r.city`,
  );
  return rows;
}

/**
 * Every region-scoped endpoint funnels through here, so an unknown region fails
 * the same way everywhere instead of silently returning an empty list — "no buses
 * found" and "that city doesn't exist" are different answers for the user.
 */
export async function getRegionOrThrow(slug) {
  const { rows } = await query(
    `SELECT id, slug, timezone, has_realtime, bbox IS NOT NULL AS has_bbox
       FROM supported_regions
      WHERE slug = $1 AND is_active`,
    [slug],
  );
  if (rows.length === 0) {
    throw new AppError(`Unknown region: ${slug}`, { status: 404, code: 'unknown_region' });
  }
  return rows[0];
}

/** Guard PostGIS from coordinates that aren't even in the right city. */
export async function assertWithinRegion(region, lat, lng) {
  if (!region.has_bbox) return;
  const { rows } = await query(
    `SELECT ST_Contains(bbox, ST_SetSRID(ST_MakePoint($2, $3), 4326)) AS inside
       FROM supported_regions WHERE id = $1`,
    [region.id, lng, lat],
  );
  if (!rows[0]?.inside) {
    throw new AppError(`Coordinates are outside ${region.slug}`, {
      status: 422,
      code: 'out_of_region',
      details: { lat, lng, region: region.slug },
    });
  }
}
