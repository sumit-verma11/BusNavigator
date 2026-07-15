#!/usr/bin/env node
/**
 * SAMPLE DATA — NOT REAL TIMETABLES.
 *
 * Real Delhi data comes from the OTD GTFS feed, which requires a free API key
 * (https://otd.delhi.gov.in). Until that key exists, the app would otherwise run on
 * a 3-stop test fixture, which makes a perfectly working app feel broken: two
 * search results, one route, an empty map.
 *
 * So this builds a plausible Delhi-shaped network — real stop names and real
 * coordinates, but INVENTED routes and timings — purely so the UI can be evaluated
 * with realistic volume. It is a development convenience and must never run against
 * production.
 *
 *   npm run seed:sample --workspace=@busnav/api
 */
import AdmZip from 'adm-zip';
import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { logger } from '../lib/logger.js';
import { pool } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { isProduction } from '../config/env.js';
import { ingestStaticFeed } from '../modules/ingestion/gtfs-static.js';

if (isProduction) {
  logger.fatal('seed:sample is development-only — it writes invented timetables');
  process.exit(1);
}

// Real Delhi stops, real coordinates. The corridors they're grouped into below are
// approximations, not DTC's actual route table.
const STOPS = [
  ['S01', 'Kashmere Gate ISBT', 28.6675, 77.2286],
  ['S02', 'Red Fort', 28.6562, 77.241],
  ['S03', 'Delhi Gate', 28.6396, 77.2409],
  ['S04', 'ITO', 28.6289, 77.2411],
  ['S05', 'Pragati Maidan', 28.6186, 77.2426],
  ['S06', 'India Gate', 28.6129, 77.2295],
  ['S07', 'Mandi House', 28.6258, 77.2344],
  ['S08', 'Connaught Place', 28.6315, 77.2167],
  ['S09', 'Shivaji Stadium', 28.6335, 77.2118],
  ['S10', 'Jhandewalan', 28.6444, 77.2016],
  ['S11', 'Karol Bagh', 28.6512, 77.1906],
  ['S12', 'Rajendra Place', 28.6423, 77.1782],
  ['S13', 'Patel Nagar', 28.6519, 77.1686],
  ['S14', 'Kirti Nagar', 28.6553, 77.1494],
  ['S15', 'Rajouri Garden', 28.6492, 77.1213],
  ['S16', 'Janakpuri West', 28.6295, 77.0784],
  ['S17', 'Uttam Nagar', 28.6219, 77.0559],
  ['S18', 'Dwarka Mor', 28.6194, 77.0331],
  ['S19', 'Dwarka Sector 21', 28.5522, 77.0583],
  ['S20', 'IGI Airport T3', 28.5562, 77.0878],
  ['S21', 'Mahipalpur', 28.5432, 77.1247],
  ['S22', 'Munirka', 28.5545, 77.1731],
  ['S23', 'AIIMS', 28.5672, 77.2076],
  ['S24', 'Green Park', 28.5596, 77.2065],
  ['S25', 'Hauz Khas', 28.5433, 77.2066],
  ['S26', 'Malviya Nagar', 28.5285, 77.2064],
  ['S27', 'Saket', 28.5222, 77.2066],
  ['S28', 'Qutub Minar', 28.5245, 77.1855],
  ['S29', 'Chhatarpur', 28.5065, 77.1747],
  ['S30', 'Nehru Place', 28.5483, 77.2513],
  ['S31', 'Kalkaji Mandir', 28.5355, 77.259],
  ['S32', 'Govind Puri', 28.5386, 77.2653],
  ['S33', 'Okhla NSIC', 28.5539, 77.2735],
  ['S34', 'Jamia Millia Islamia', 28.5615, 77.2807],
  ['S35', 'Sarai Kale Khan', 28.5885, 77.2571],
  ['S36', 'Nizamuddin', 28.5896, 77.2503],
  ['S37', 'Lajpat Nagar', 28.5705, 77.2364],
  ['S38', 'Moolchand', 28.5652, 77.2337],
  ['S39', 'Ashram', 28.5723, 77.2591],
  ['S40', 'Laxmi Nagar', 28.6304, 77.2775],
  ['S41', 'Anand Vihar ISBT', 28.6469, 77.3159],
  ['S42', 'Preet Vihar', 28.6412, 77.2946],
  ['S43', 'Karkardooma', 28.6519, 77.3033],
  ['S44', 'Seelampur', 28.6701, 77.2664],
  ['S45', 'Shahdara', 28.6733, 77.2887],
  ['S46', 'Rohini West', 28.7146, 77.1064],
  ['S47', 'Pitampura', 28.7031, 77.1324],
  ['S48', 'Netaji Subhash Place', 28.6959, 77.1524],
  ['S49', 'Model Town', 28.7028, 77.1918],
  ['S50', 'GTB Nagar', 28.6979, 77.2064],
  ['S51', 'Vishwavidyalaya', 28.6875, 77.2137],
  ['S52', 'Civil Lines', 28.6772, 77.2249],
  ['S53', 'Azadpur', 28.7075, 77.1806],
  ['S54', 'Punjabi Bagh', 28.6684, 77.1341],
  ['S55', 'Paschim Vihar', 28.6702, 77.1024],
];

// Invented corridors over those real stops.
const ROUTES = [
  [
    'R764',
    '764',
    'Nehru Place → Anand Vihar ISBT',
    'E11E5A',
    ['S30', 'S31', 'S32', 'S39', 'S37', 'S38', 'S35', 'S36', 'S40', 'S42', 'S41'],
  ],
  [
    'R500',
    '500',
    'Anand Vihar ISBT → Nehru Place',
    '1E88E5',
    ['S41', 'S42', 'S40', 'S36', 'S35', 'S38', 'S37', 'S39', 'S32', 'S31', 'S30'],
  ],
  [
    'R620',
    '620',
    'Kashmere Gate → IGI Airport T3',
    '8E24AA',
    ['S01', 'S02', 'S03', 'S08', 'S09', 'S11', 'S13', 'S15', 'S21', 'S20'],
  ],
  [
    'R871',
    '871',
    'Dwarka Mor → Connaught Place',
    '00897B',
    ['S18', 'S17', 'S16', 'S15', 'S14', 'S13', 'S11', 'S10', 'S08'],
  ],
  [
    'R534',
    '534',
    'Kashmere Gate → Chhatarpur',
    'F4511E',
    ['S01', 'S52', 'S08', 'S07', 'S06', 'S23', 'S25', 'S27', 'S28', 'S29'],
  ],
  [
    'R405',
    '405',
    'Anand Vihar ISBT → Dwarka Sector 21',
    '5E35B1',
    ['S41', 'S43', 'S45', 'S44', 'S04', 'S08', 'S12', 'S15', 'S16', 'S19'],
  ],
  [
    'R181',
    '181',
    'Rohini West → AIIMS',
    '3949AB',
    ['S46', 'S47', 'S48', 'S53', 'S49', 'S50', 'S51', 'S52', 'S08', 'S23'],
  ],
  [
    'R419',
    '419',
    'Nehru Place → Uttam Nagar',
    '00838F',
    ['S30', 'S26', 'S25', 'S24', 'S23', 'S22', 'S21', 'S15', 'S16', 'S17'],
  ],
  [
    'R901',
    '901',
    'Paschim Vihar → Kashmere Gate',
    '6D4C41',
    ['S55', 'S54', 'S48', 'S53', 'S49', 'S51', 'S52', 'S01'],
  ],
  [
    'R966',
    '966',
    'Saket → Shahdara',
    'C0392B',
    ['S27', 'S26', 'S30', 'S39', 'S37', 'S04', 'S03', 'S02', 'S44', 'S45'],
  ],
];

const pad = (n) => String(n).padStart(2, '0');
const hhmmss = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00`;

const stopById = new Map(STOPS.map(([id, name, lat, lon]) => [id, { id, name, lat, lon }]));

function buildZip() {
  const zip = new AdmZip();
  const add = (name, content) => zip.addFile(name, Buffer.from(content, 'utf8'));

  add(
    'agency.txt',
    'agency_id,agency_name,agency_url,agency_timezone\nDTC,Delhi Transport Corporation (SAMPLE),https://dtc.delhi.gov.in,Asia/Kolkata\n',
  );

  add(
    'stops.txt',
    'stop_id,stop_code,stop_name,stop_lat,stop_lon\n' +
      STOPS.map(([id, name, lat, lon], i) => `${id},${1000 + i},${name},${lat},${lon}`).join('\n') +
      '\n',
  );

  add(
    'routes.txt',
    'route_id,agency_id,route_short_name,route_long_name,route_type,route_color\n' +
      ROUTES.map(([id, short, long, colour]) => `${id},DTC,${short},${long},3,${colour}`).join(
        '\n',
      ) +
      '\n',
  );

  add(
    'calendar.txt',
    'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n' +
      'DAILY,1,1,1,1,1,1,1,20200101,20301231\n',
  );
  add('calendar_dates.txt', 'service_id,date,exception_type\n');

  const shapeLines = ['shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence'];
  const tripLines = ['route_id,service_id,trip_id,trip_headsign,direction_id,shape_id'];
  const stopTimeLines = ['trip_id,arrival_time,departure_time,stop_id,stop_sequence'];

  for (const [routeId, , longName, , sequence] of ROUTES) {
    const shapeId = `SH_${routeId}`;
    sequence.forEach((stopId, i) => {
      const s = stopById.get(stopId);
      shapeLines.push(`${shapeId},${s.lat},${s.lon},${i + 1}`);
    });

    const headsign = longName.split('→').pop().trim();

    // A bus every 20 minutes, 05:00 to 23:00 — and one late run that crosses
    // midnight, because that is the case the whole INTERVAL schema exists for.
    let tripIndex = 0;
    for (let start = 5 * 60; start <= 23 * 60 + 40; start += 20) {
      const tripId = `${routeId}_T${tripIndex++}`;
      tripLines.push(`${routeId},DAILY,${tripId},${headsign},0,${shapeId}`);

      sequence.forEach((stopId, i) => {
        const t = start + i * 4; // ~4 minutes between stops
        stopTimeLines.push(`${tripId},${hhmmss(t)},${hhmmss(t)},${stopId},${i + 1}`);
      });
    }
  }

  add('shapes.txt', shapeLines.join('\n') + '\n');
  add('trips.txt', tripLines.join('\n') + '\n');
  add('stop_times.txt', stopTimeLines.join('\n') + '\n');

  return zip.toBuffer();
}

const zipPath = path.join(tmpdir(), `busnav-sample-${Date.now()}.zip`);

try {
  await writeFile(zipPath, buildZip());
  const result = await ingestStaticFeed({ regionSlug: 'delhi', source: zipPath, force: true });
  logger.warn(
    { stats: result.stats },
    'SAMPLE data ingested for delhi — invented timetables, real stop names. Replace with the OTD feed.',
  );
} catch (err) {
  logger.fatal({ err }, 'sample seed failed');
  process.exitCode = 1;
} finally {
  await rm(zipPath, { force: true });
  await Promise.allSettled([pool.end(), redis.quit()]);
}
