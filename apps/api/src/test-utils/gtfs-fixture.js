import AdmZip from 'adm-zip';
import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { query } from '../lib/db.js';
import { ingestStaticFeed } from '../modules/ingestion/gtfs-static.js';

/**
 * A small but realistic Delhi-shaped feed. Tests run against data that went through
 * the actual ingestion pipeline — hand-inserted rows would let a parser bug pass.
 *
 * Geography: S1 Nehru Place -> S2 Kalkaji (~1.5km) -> S3 Anand Vihar (~13km).
 * Route 764 runs S1->S2->S3 on weekdays; route 500 runs the reverse (S3->S1) so that
 * direction actually means something in the tests.
 */
export function buildFixtureZip({ serviceDays = '1,1,1,1,1,1,1', withNearbyStop = false } = {}) {
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
      'S2,102,Kalkaji Mandir,28.5355,77.2590\n' +
      'S3,103,Anand Vihar ISBT,28.6469,77.3159\n' +
      // S4 sits ~100m from S1 and is served by no trip. It exists so a test can pick
      // it as an origin and prove the fallback finds the bus that leaves from S1
      // nearby — the "one place, many stop ids, newcomer picks the wrong one" case.
      (withNearbyStop ? 'S4,104,Nehru Place Metro Gate 2,28.5490,77.2520\n' : ''),
  );
  add(
    'routes.txt',
    'route_id,agency_id,route_short_name,route_long_name,route_type,route_color\n' +
      'R1,DTC,764,Nehru Place - Anand Vihar,3,E11E5A\n' +
      'R2,DTC,500,Anand Vihar - Nehru Place,3,1E88E5\n',
  );
  add(
    'shapes.txt',
    'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n' +
      'SH1,28.5483,77.2513,1\nSH1,28.5355,77.2590,2\nSH1,28.6469,77.3159,3\n',
  );
  add(
    'calendar.txt',
    'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n' +
      `ALLDAYS,${serviceDays.split(',').join(',')},20200101,20301231\n` +
      'NEVER,0,0,0,0,0,0,0,20200101,20301231\n',
  );
  add('calendar_dates.txt', 'service_id,date,exception_type\n');
  add(
    'trips.txt',
    'route_id,service_id,trip_id,trip_headsign,direction_id,shape_id\n' +
      'R1,ALLDAYS,T1,Anand Vihar ISBT,0,SH1\n' +
      'R1,ALLDAYS,T2,Anand Vihar ISBT,0,SH1\n' +
      'R1,NEVER,T3,Anand Vihar ISBT,0,SH1\n' + // never runs — must not surface as a departure
      'R2,ALLDAYS,T4,Nehru Place,1,\n',
  );
  add(
    'stop_times.txt',
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n' +
      // T1: an early trip, and T2 a late-night one that crosses midnight.
      'T1,06:00:00,06:00:00,S1,1\nT1,06:12:00,06:12:00,S2,2\nT1,06:50:00,06:50:00,S3,3\n' +
      'T2,23:50:00,23:50:00,S1,1\nT2,24:05:00,24:05:00,S2,2\nT2,25:10:00,25:10:00,S3,3\n' +
      'T3,09:00:00,09:00:00,S1,1\nT3,09:40:00,09:40:00,S3,2\n' +
      // T4 runs the other way: S3 -> S1.
      'T4,07:00:00,07:00:00,S3,1\nT4,07:45:00,07:45:00,S1,2\n',
  );

  return zip.toBuffer();
}

/** Creates the region, ingests the fixture, and returns ids the tests need. */
export async function seedRegion(slug, options) {
  await query(
    `INSERT INTO supported_regions (slug, state, city, timezone, bbox, is_active, has_realtime)
     VALUES ($1, 'Delhi', 'New Delhi', 'Asia/Kolkata',
             ST_MakeEnvelope(76.8388, 28.4041, 77.3465, 28.8835, 4326), TRUE, FALSE)
     ON CONFLICT (slug) DO UPDATE SET has_realtime = FALSE`,
    [slug],
  );

  const zipPath = path.join(tmpdir(), `busnav-${slug}-${Date.now()}.zip`);
  await writeFile(zipPath, buildFixtureZip(options));
  await ingestStaticFeed({ regionSlug: slug, source: zipPath, force: true });
  await rm(zipPath, { force: true });

  const { rows: stops } = await query(
    `SELECT s.id, s.gtfs_stop_id FROM stops s
       JOIN supported_regions r ON r.id = s.region_id WHERE r.slug = $1`,
    [slug],
  );
  const { rows: routes } = await query(
    `SELECT rt.id, rt.gtfs_route_id FROM routes rt
       JOIN supported_regions r ON r.id = rt.region_id WHERE r.slug = $1`,
    [slug],
  );

  return {
    stops: Object.fromEntries(stops.map((s) => [s.gtfs_stop_id, s.id])),
    routes: Object.fromEntries(routes.map((r) => [r.gtfs_route_id, r.id])),
  };
}

export async function dropRegion(slug) {
  await query('DELETE FROM supported_regions WHERE slug = $1', [slug]); // cascades
}
