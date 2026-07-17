import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../app.js';
import { pool } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';
import { seedRegion, dropRegion } from '../../test-utils/gtfs-fixture.js';
import { searchDirectRoutes } from './routes.service.js';

const REGION = 'test-routes';
const app = createApp();
let ids;

/** A UTC instant that lands on the given wall-clock time in Delhi (UTC+5:30). */
function istAt(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const utcMinutes = h * 60 + m - (5 * 60 + 30);
  const d = new Date(Date.UTC(2026, 5, 10, 0, 0, 0)); // a Wednesday — ALLDAYS runs
  d.setUTCMinutes(d.getUTCMinutes() + utcMinutes);
  return d;
}

before(async () => {
  ids = await seedRegion(REGION, { withNearbyStop: true });
});

test('finds the direct route between two stops', async () => {
  const res = await request(app)
    .get('/routes/search')
    .query({ region: REGION, from: ids.stops.S1, to: ids.stops.S3 });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].shortName, '764');
  assert.equal(res.body.data[0].stopsBetween, 1); // S1 -> S3 via T3 is one hop
});

test('an exact match names no nearby stop', async () => {
  // When the bus leaves from the stop you actually picked, there is nothing to
  // explain — boardAt/alightAt stay null so the UI shows no "walk to" note.
  const res = await request(app)
    .get('/routes/search')
    .query({ region: REGION, from: ids.stops.S1, to: ids.stops.S3 });

  assert.equal(res.body.data[0].boardAt, null);
  assert.equal(res.body.data[0].alightAt, null);
});

test('falls back to a walkable stop when the exact stop has no bus', async () => {
  // S4 (Nehru Place Metro) is served by no trip — the classic "newcomer picks the
  // wrong stop id for the right place". No exact bus exists, but S1 ~100m away runs
  // the 764 to S3, so we surface it and say where to actually board.
  const res = await request(app)
    .get('/routes/search')
    .query({ region: REGION, from: ids.stops.S4, to: ids.stops.S3 });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 1, 'the nearby bus must be found, not hidden');
  const route = res.body.data[0];
  assert.equal(route.shortName, '764');
  assert.equal(route.boardAt.name, 'Nehru Place', 'must name the stop the bus leaves from');
  assert.ok(route.boardAt.distanceM > 0, 'and how far to walk to it');
  assert.equal(route.alightAt, null, 'the destination stop was exact, so nothing to add there');
});

test('direction matters: the reverse leg is served by a different route', async () => {
  const res = await request(app)
    .get('/routes/search')
    .query({ region: REGION, from: ids.stops.S3, to: ids.stops.S1 });

  assert.equal(res.status, 200);
  const names = res.body.data.map((r) => r.shortName);
  assert.deepEqual(names, ['500'], 'must not offer 764 for a journey it runs backwards');
});

test('never-running services do not produce departures', async () => {
  // Trip T3 (service NEVER) connects S1->S3 in one hop, so the ROUTE must appear...
  const res = await request(app)
    .get('/routes/search')
    .query({ region: REGION, from: ids.stops.S1, to: ids.stops.S3 });

  const route = res.body.data[0];
  // ...but its departures must only ever come from services that actually run today.
  const times = route.nextDepartures.map((d) => d.time);
  assert.ok(!times.includes('09:00'), 'a service that never runs must not be offered');
});

test('returns only departures still to come, at a pinned clock', async () => {
  // Clock pinned: at 05:00 IST both of the day's 764 departures (06:00, 23:50) are ahead.
  const early = await searchDirectRoutes(
    { region: REGION, from: ids.stops.S1, to: ids.stops.S2, limit: 10 },
    { now: istAt('05:00') },
  );
  const times = early.find((r) => r.shortName === '764').nextDepartures.map((d) => d.time);
  assert.deepEqual(times, ['06:00', '23:50']);
});

test('once the last bus has gone, the route remains but its departures are empty', async () => {
  // 23:55 IST: the 23:50 has left. This is "last bus has gone" — a DIFFERENT empty
  // state from "no such route", and the UI must be able to tell them apart.
  const late = await searchDirectRoutes(
    { region: REGION, from: ids.stops.S1, to: ids.stops.S2, limit: 10 },
    { now: istAt('23:55') },
  );
  const route = late.find((r) => r.shortName === '764');
  assert.ok(route, 'the route itself must still be listed');
  assert.deepEqual(route.nextDepartures, [], 'but with nothing left to catch');
});

test('departures are formatted for display, never raw GTFS intervals', async () => {
  const res = await request(app)
    .get('/routes/search')
    .query({ region: REGION, from: ids.stops.S1, to: ids.stops.S2 });

  for (const route of res.body.data) {
    for (const d of route.nextDepartures) {
      assert.match(d.time, /^([01]\d|2[0-3]):[0-5]\d$/, 'must be a clock time, not 25:10');
      assert.equal(typeof d.nextDay, 'boolean');
    }
  }
});

test('same origin and destination is rejected', async () => {
  const res = await request(app)
    .get('/routes/search')
    .query({ region: REGION, from: ids.stops.S1, to: ids.stops.S1 });

  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'same_stop');
});

test('a stop from another region is a 404, not an empty result', async () => {
  const res = await request(app)
    .get('/routes/search')
    .query({ region: REGION, from: ids.stops.S1, to: 999999 });

  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'unknown_stop');
});

test('returns the route shape as GeoJSON ready for the map', async () => {
  const res = await request(app).get(`/routes/${ids.routes.R1}/shape`);

  assert.equal(res.status, 200);
  assert.equal(res.body.data.geometry.type, 'LineString');
  assert.equal(res.body.data.geometry.coordinates.length, 3);
  assert.deepEqual(res.body.data.geometry.coordinates[0], [77.2513, 28.5483]); // [lng, lat]
});

test('a route with no shape returns 404 rather than an empty geometry', async () => {
  const res = await request(app).get(`/routes/${ids.routes.R2}/shape`);

  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'shape_not_found');
});

after(async () => {
  await dropRegion(REGION);
  await Promise.allSettled([pool.end(), redis.quit()]);
});
