import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { query, pool } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';
import { ingestStaticFeed } from './gtfs-static.js';

const REGION = 'test-static';
let zipPath;

/** A minimal but *legal* GTFS feed, including the past-midnight time that breaks naive parsers. */
function buildFixtureZip() {
  const zip = new AdmZip();
  const add = (name, content) => zip.addFile(name, Buffer.from(content, 'utf8'));

  add(
    'agency.txt',
    'agency_id,agency_name,agency_url,agency_timezone\nDTC,Delhi Transport Corp,https://dtc.example,Asia/Kolkata\n',
  );
  add(
    'stops.txt',
    'stop_id,stop_code,stop_name,stop_lat,stop_lon\n' +
      'S1,101,Nehru Place,28.5483,77.2513\n' +
      'S2,102,Kalkaji,28.5355,77.2590\n' +
      'S3,103,Anand Vihar ISBT,28.6469,77.3159\n',
  );
  add(
    'routes.txt',
    'route_id,agency_id,route_short_name,route_long_name,route_type\nR1,DTC,764,Nehru Place - Anand Vihar,3\n',
  );
  add(
    'shapes.txt',
    'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n' +
      'SH1,28.5483,77.2513,1\nSH1,28.5355,77.2590,2\nSH1,28.6469,77.3159,3\n',
  );
  add(
    'calendar.txt',
    'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWD,1,1,1,1,1,0,0,20260101,20261231\n',
  );
  add('calendar_dates.txt', 'service_id,date,exception_type\nWD,20260315,2\n');
  add(
    'trips.txt',
    'route_id,service_id,trip_id,trip_headsign,direction_id,shape_id\nR1,WD,T1,Anand Vihar ISBT,0,SH1\n',
  );
  add(
    'stop_times.txt',
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n' +
      'T1,23:50:00,23:50:00,S1,1\n' +
      'T1,24:30:00,24:30:00,S2,2\n' + // past midnight — TIME would reject this
      'T1,25:10:00,25:10:00,S3,3\n',
  );
  return zip.toBuffer();
}

before(async () => {
  await query(
    `INSERT INTO supported_regions (slug, state, city, is_active)
     VALUES ($1, 'Delhi', 'New Delhi', TRUE)
     ON CONFLICT (slug) DO NOTHING`,
    [REGION],
  );
  zipPath = path.join(tmpdir(), `busnav-fixture-${Date.now()}.zip`);
  await writeFile(zipPath, buildFixtureZip());
});

test('ingests a static feed into the region', async () => {
  const result = await ingestStaticFeed({ regionSlug: REGION, source: zipPath });

  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.stats, {
    agencies: 1,
    stops: 3,
    shapes: 1,
    routes: 1,
    calendar: 1,
    calendar_dates: 1,
    trips: 1,
    stop_times: 3,
  });
});

test('preserves past-midnight GTFS times (25:10:00) as INTERVAL', async () => {
  const { rows } = await query(
    `SELECT st.departure_time
       FROM stop_times st
       JOIN trips t ON t.id = st.trip_id
       JOIN supported_regions r ON r.id = t.region_id
      WHERE r.slug = $1 AND st.stop_sequence = 3`,
    [REGION],
  );
  assert.equal(rows[0].departure_time.hours, 25);
  assert.equal(rows[0].departure_time.minutes, 10);
});

test('stores stop locations as queryable geography', async () => {
  // Nehru Place -> Kalkaji is ~1.5km; 2km radius must find it, 200m must not.
  const near = await query(
    `SELECT s.name FROM stops s JOIN supported_regions r ON r.id = s.region_id
      WHERE r.slug = $1
        AND ST_DWithin(s.location, ST_SetSRID(ST_MakePoint(77.2513, 28.5483), 4326)::geography, 2000)`,
    [REGION],
  );
  const names = near.rows.map((r) => r.name).sort();
  assert.deepEqual(names, ['Kalkaji', 'Nehru Place']);
});

test('builds one LineString per shape, not one row per point', async () => {
  const { rows } = await query(
    `SELECT ST_NPoints(geom) AS points FROM shapes s
       JOIN supported_regions r ON r.id = s.region_id WHERE r.slug = $1`,
    [REGION],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].points, 3);
});

test('re-ingesting identical content is skipped, not re-upserted', async () => {
  const result = await ingestStaticFeed({ regionSlug: REGION, source: zipPath });
  assert.equal(result.status, 'skipped');

  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM stops s
       JOIN supported_regions r ON r.id = s.region_id WHERE r.slug = $1`,
    [REGION],
  );
  assert.equal(rows[0].n, 3, 'stops must not be duplicated on re-run');
});

test('--force re-ingests and converges instead of duplicating', async () => {
  const result = await ingestStaticFeed({ regionSlug: REGION, source: zipPath, force: true });
  assert.equal(result.status, 'succeeded');

  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM stop_times st
       JOIN trips t ON t.id = st.trip_id
       JOIN supported_regions r ON r.id = t.region_id WHERE r.slug = $1`,
    [REGION],
  );
  assert.equal(rows[0].n, 3, 'upserts must converge, not accumulate');
});

test('rejects an unknown region', async () => {
  await assert.rejects(() => ingestStaticFeed({ regionSlug: 'atlantis', source: zipPath }), {
    code: 'unknown_region',
  });
});

after(async () => {
  await query('DELETE FROM supported_regions WHERE slug = $1', [REGION]); // cascades
  await rm(zipPath, { force: true });
  await Promise.allSettled([pool.end(), redis.quit()]);
});
