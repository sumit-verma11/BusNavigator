import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import AdmZip from 'adm-zip';
import { parse as parseCsv } from 'csv-parse/sync';
import { query, withTransaction } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { AppError } from '../../middleware/error.js';

const log = logger.child({ module: 'gtfs-static' });

// Insert in chunks: one 200k-row VALUES list will blow past Postgres' 65535
// bound-parameter limit, and one-row-per-INSERT takes minutes instead of seconds.
const CHUNK_SIZE = 500;

async function fetchFeed(source) {
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const res = await fetch(source);
    if (!res.ok) {
      throw new AppError(`GTFS feed fetch failed: ${res.status} ${res.statusText}`, {
        status: 502,
        code: 'feed_unavailable',
      });
    }
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(source);
}

function readTable(zip, filename) {
  const entry = zip.getEntry(filename);
  if (!entry) return [];
  return parseCsv(entry.getData(), {
    // Agency-published feeds are frequently UTF-8 BOM'd, which turns the first
    // column name into "<BOM>stop_id" and silently loses every stop.
    columns: (header) => header.map((h) => h.replace(/^\uFEFF/, '').trim()),
    skip_empty_lines: true,
    trim: true,
  });
}

/** GTFS allows '25:10:00' for past-midnight service. Postgres INTERVAL accepts it; TIME would not. */
const toInterval = (value) => (value ? value : null);
const toNumber = (value) => (value === '' || value == null ? null : Number(value));

async function insertChunked(client, rows, buildStatement) {
  let count = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const { text, values } = buildStatement(chunk);
    const res = await client.query(text, values);
    count += res.rowCount ?? chunk.length;
  }
  return count;
}

/**
 * Ingest a GTFS static feed. Safe to re-run: identical feed content is skipped
 * outright, and every write is an upsert keyed on (region_id, gtfs_*_id), so a
 * partial run followed by a retry converges instead of duplicating.
 */
export async function ingestStaticFeed({ regionSlug, source, force = false }) {
  const { rows: regions } = await query('SELECT id, slug FROM supported_regions WHERE slug = $1', [
    regionSlug,
  ]);
  const region = regions[0];
  if (!region) {
    throw new AppError(`Unknown region: ${regionSlug}`, { status: 404, code: 'unknown_region' });
  }

  const buffer = await fetchFeed(source);
  const contentHash = createHash('sha256').update(buffer).digest('hex');

  const { rows: previous } = await query(
    `SELECT content_hash FROM feed_imports
      WHERE region_id = $1 AND status = 'succeeded'
      ORDER BY started_at DESC LIMIT 1`,
    [region.id],
  );

  if (!force && previous[0]?.content_hash === contentHash) {
    await query(
      `INSERT INTO feed_imports (region_id, feed_url, content_hash, status, finished_at)
       VALUES ($1, $2, $3, 'skipped', now())`,
      [region.id, source, contentHash],
    );
    log.info({ regionSlug, contentHash }, 'feed unchanged — skipping ingest');
    return { status: 'skipped', contentHash, stats: {} };
  }

  const { rows: importRows } = await query(
    `INSERT INTO feed_imports (region_id, feed_url, content_hash, status)
     VALUES ($1, $2, $3, 'running') RETURNING id`,
    [region.id, source, contentHash],
  );
  const importId = importRows[0].id;

  try {
    const zip = new AdmZip(buffer);
    const stats = await withTransaction((client) => loadFeed(client, region.id, zip));

    await query(
      `UPDATE feed_imports
          SET status = 'succeeded', finished_at = now(), stats = $2
        WHERE id = $1`,
      [importId, JSON.stringify(stats)],
    );

    log.info({ regionSlug, contentHash, stats }, 'static feed ingested');
    return { status: 'succeeded', contentHash, stats };
  } catch (err) {
    await query(
      `UPDATE feed_imports
          SET status = 'failed', finished_at = now(), error = $2
        WHERE id = $1`,
      [importId, String(err.message).slice(0, 1000)],
    );
    log.error({ err, regionSlug }, 'static feed ingest failed — rolled back');
    throw err;
  }
}

async function loadFeed(client, regionId, zip) {
  const stats = {};

  // --- agencies -------------------------------------------------------------
  const agencies = readTable(zip, 'agency.txt');
  stats.agencies = await insertChunked(client, agencies, (chunk) => {
    const values = [];
    const tuples = chunk.map((a, i) => {
      const o = i * 5;
      values.push(
        regionId,
        a.agency_id || 'default',
        a.agency_name ?? '',
        a.agency_url ?? null,
        a.agency_timezone ?? null,
      );
      return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5})`;
    });
    return {
      text: `INSERT INTO agencies (region_id, gtfs_agency_id, name, url, timezone)
             VALUES ${tuples.join(',')}
             ON CONFLICT (region_id, gtfs_agency_id)
             DO UPDATE SET name = EXCLUDED.name, url = EXCLUDED.url, timezone = EXCLUDED.timezone`,
      values,
    };
  });

  // --- stops ----------------------------------------------------------------
  const stops = readTable(zip, 'stops.txt').filter((s) => s.stop_lat && s.stop_lon);
  stats.stops = await insertChunked(client, stops, (chunk) => {
    const values = [];
    const tuples = chunk.map((s, i) => {
      const o = i * 7;
      values.push(
        regionId,
        s.stop_id,
        s.stop_code || null,
        s.stop_name ?? '',
        toNumber(s.stop_lon),
        toNumber(s.stop_lat),
        toNumber(s.location_type) ?? 0,
      );
      return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4},
               ST_SetSRID(ST_MakePoint($${o + 5}, $${o + 6}), 4326)::geography, $${o + 7})`;
    });
    return {
      text: `INSERT INTO stops (region_id, gtfs_stop_id, code, name, location, location_type)
             VALUES ${tuples.join(',')}
             ON CONFLICT (region_id, gtfs_stop_id)
             DO UPDATE SET name = EXCLUDED.name, code = EXCLUDED.code,
                           location = EXCLUDED.location, updated_at = now()`,
      values,
    };
  });

  const stopIds = await idMap(client, 'stops', 'gtfs_stop_id', regionId);
  const agencyIds = await idMap(client, 'agencies', 'gtfs_agency_id', regionId);

  // --- shapes: one LineString per shape_id, not one row per point ------------
  const shapePoints = readTable(zip, 'shapes.txt');
  const byShape = new Map();
  for (const p of shapePoints) {
    if (!byShape.has(p.shape_id)) byShape.set(p.shape_id, []);
    byShape.get(p.shape_id).push(p);
  }
  const shapes = [...byShape.entries()]
    .map(([shapeId, points]) => {
      points.sort((a, b) => Number(a.shape_pt_sequence) - Number(b.shape_pt_sequence));
      return { shapeId, points };
    })
    .filter((s) => s.points.length >= 2); // a LineString needs 2+ points

  stats.shapes = await insertChunked(client, shapes, (chunk) => {
    const values = [];
    const tuples = chunk.map((s, i) => {
      const o = i * 3;
      const wkt = `LINESTRING(${s.points.map((p) => `${Number(p.shape_pt_lon)} ${Number(p.shape_pt_lat)}`).join(',')})`;
      values.push(regionId, s.shapeId, wkt);
      return `($${o + 1}, $${o + 2}, ST_GeomFromText($${o + 3}, 4326))`;
    });
    return {
      text: `INSERT INTO shapes (region_id, gtfs_shape_id, geom)
             VALUES ${tuples.join(',')}
             ON CONFLICT (region_id, gtfs_shape_id) DO UPDATE SET geom = EXCLUDED.geom`,
      values,
    };
  });

  const shapeIds = await idMap(client, 'shapes', 'gtfs_shape_id', regionId);

  // --- routes ---------------------------------------------------------------
  const routes = readTable(zip, 'routes.txt');
  stats.routes = await insertChunked(client, routes, (chunk) => {
    const values = [];
    const tuples = chunk.map((r, i) => {
      const o = i * 8;
      values.push(
        regionId,
        r.route_id,
        agencyIds.get(r.agency_id || 'default') ?? null,
        r.route_short_name || null,
        r.route_long_name || null,
        toNumber(r.route_type) ?? 3,
        r.route_color || null,
        r.route_text_color || null,
      );
      return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7}, $${o + 8})`;
    });
    return {
      text: `INSERT INTO routes (region_id, gtfs_route_id, agency_id, short_name, long_name,
                                 route_type, color, text_color)
             VALUES ${tuples.join(',')}
             ON CONFLICT (region_id, gtfs_route_id)
             DO UPDATE SET short_name = EXCLUDED.short_name, long_name = EXCLUDED.long_name,
                           route_type = EXCLUDED.route_type, color = EXCLUDED.color,
                           text_color = EXCLUDED.text_color, updated_at = now()`,
      values,
    };
  });

  const routeIds = await idMap(client, 'routes', 'gtfs_route_id', regionId);

  // --- calendar / calendar_dates -------------------------------------------
  const calendar = readTable(zip, 'calendar.txt');
  stats.calendar = await insertChunked(client, calendar, (chunk) => {
    const values = [];
    const tuples = chunk.map((c, i) => {
      const o = i * 11;
      values.push(
        regionId,
        c.service_id,
        c.monday === '1',
        c.tuesday === '1',
        c.wednesday === '1',
        c.thursday === '1',
        c.friday === '1',
        c.saturday === '1',
        c.sunday === '1',
        gtfsDate(c.start_date),
        gtfsDate(c.end_date),
      );
      return `(${Array.from({ length: 11 }, (_, k) => `$${o + k + 1}`).join(',')})`;
    });
    return {
      text: `INSERT INTO calendar (region_id, service_id, monday, tuesday, wednesday, thursday,
                                   friday, saturday, sunday, start_date, end_date)
             VALUES ${tuples.join(',')}
             ON CONFLICT (region_id, service_id)
             DO UPDATE SET monday = EXCLUDED.monday, tuesday = EXCLUDED.tuesday,
                           wednesday = EXCLUDED.wednesday, thursday = EXCLUDED.thursday,
                           friday = EXCLUDED.friday, saturday = EXCLUDED.saturday,
                           sunday = EXCLUDED.sunday, start_date = EXCLUDED.start_date,
                           end_date = EXCLUDED.end_date`,
      values,
    };
  });

  const calendarDates = readTable(zip, 'calendar_dates.txt');
  stats.calendar_dates = await insertChunked(client, calendarDates, (chunk) => {
    const values = [];
    const tuples = chunk.map((c, i) => {
      const o = i * 4;
      values.push(regionId, c.service_id, gtfsDate(c.date), toNumber(c.exception_type));
      return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4})`;
    });
    return {
      text: `INSERT INTO calendar_dates (region_id, service_id, date, exception_type)
             VALUES ${tuples.join(',')}
             ON CONFLICT (region_id, service_id, date)
             DO UPDATE SET exception_type = EXCLUDED.exception_type`,
      values,
    };
  });

  // --- trips ----------------------------------------------------------------
  const trips = readTable(zip, 'trips.txt').filter((t) => routeIds.has(t.route_id));
  stats.trips = await insertChunked(client, trips, (chunk) => {
    const values = [];
    const tuples = chunk.map((t, i) => {
      const o = i * 7;
      values.push(
        regionId,
        t.trip_id,
        routeIds.get(t.route_id),
        t.shape_id ? (shapeIds.get(t.shape_id) ?? null) : null,
        t.service_id ?? '',
        t.trip_headsign || null,
        t.direction_id === '' || t.direction_id == null ? null : Number(t.direction_id),
      );
      return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7})`;
    });
    return {
      text: `INSERT INTO trips (region_id, gtfs_trip_id, route_id, shape_id, service_id,
                                headsign, direction_id)
             VALUES ${tuples.join(',')}
             ON CONFLICT (region_id, gtfs_trip_id)
             DO UPDATE SET route_id = EXCLUDED.route_id, shape_id = EXCLUDED.shape_id,
                           service_id = EXCLUDED.service_id, headsign = EXCLUDED.headsign,
                           direction_id = EXCLUDED.direction_id`,
      values,
    };
  });

  const tripIds = await idMap(client, 'trips', 'gtfs_trip_id', regionId);

  // --- stop_times (the big one) ---------------------------------------------
  const stopTimes = readTable(zip, 'stop_times.txt').filter(
    (st) => tripIds.has(st.trip_id) && stopIds.has(st.stop_id),
  );
  stats.stop_times = await insertChunked(client, stopTimes, (chunk) => {
    const values = [];
    const tuples = chunk.map((st, i) => {
      const o = i * 5;
      values.push(
        tripIds.get(st.trip_id),
        stopIds.get(st.stop_id),
        Number(st.stop_sequence),
        toInterval(st.arrival_time),
        toInterval(st.departure_time),
      );
      return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}::interval, $${o + 5}::interval)`;
    });
    return {
      text: `INSERT INTO stop_times (trip_id, stop_id, stop_sequence, arrival_time, departure_time)
             VALUES ${tuples.join(',')}
             ON CONFLICT (trip_id, stop_sequence)
             DO UPDATE SET stop_id = EXCLUDED.stop_id, arrival_time = EXCLUDED.arrival_time,
                           departure_time = EXCLUDED.departure_time`,
      values,
    };
  });

  return stats;
}

/** GTFS ids are text and only unique per feed; the DB joins on ints. Map one to the other. */
async function idMap(client, table, gtfsColumn, regionId) {
  const { rows } = await client.query(
    `SELECT id, ${gtfsColumn} AS gtfs_id FROM ${table} WHERE region_id = $1`,
    [regionId],
  );
  return new Map(rows.map((r) => [r.gtfs_id, r.id]));
}

/** GTFS dates are YYYYMMDD. */
function gtfsDate(value) {
  if (!value || value.length !== 8) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}
