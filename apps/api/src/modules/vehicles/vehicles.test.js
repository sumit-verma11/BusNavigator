import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../app.js';
import { query, pool } from '../../lib/db.js';
import { redis, keys } from '../../lib/redis.js';
import { seedRegion, dropRegion } from '../../test-utils/gtfs-fixture.js';

const REGION = 'test-vehicles';
const app = createApp();
let ids;

const setRealtime = (on) =>
  query('UPDATE supported_regions SET has_realtime = $2 WHERE slug = $1', [REGION, on]);

before(async () => {
  ids = await seedRegion(REGION);
});

test('with realtime off, returns 200 + stale rather than an error', async () => {
  await setRealtime(false);

  const res = await request(app)
    .get('/vehicles/live')
    .query({ region: REGION, route: ids.routes.R1 });

  assert.equal(res.status, 200, 'a dead feed must not break the screen');
  assert.equal(res.body.data.stale, true);
  assert.equal(res.body.data.reason, 'realtime_unavailable');
  assert.deepEqual(res.body.data.vehicles, []);
});

test('with realtime on, returns live positions from redis', async () => {
  await setRealtime(true);
  // The poller keys by GTFS route id ('R1'), not our surrogate id — this asserts the
  // API translates correctly, which is exactly where the two halves could drift apart.
  await redis.set(
    keys.vehicle(REGION, 'BUS1'),
    JSON.stringify({ id: 'BUS1', routeId: 'R1', lat: 28.55, lng: 77.25, bearing: 90 }),
    'EX',
    60,
  );
  await redis.sadd(keys.vehiclesByRoute(REGION, 'R1'), 'BUS1');

  const res = await request(app)
    .get('/vehicles/live')
    .query({ region: REGION, route: ids.routes.R1 });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.stale, false);
  assert.equal(res.body.data.vehicles.length, 1);
  assert.equal(res.body.data.vehicles[0].id, 'BUS1');
  assert.equal(res.body.data.vehicles[0].lat, 28.55);
});

test('an expired position is dropped, not returned as null', async () => {
  await setRealtime(true);
  await redis.sadd(keys.vehiclesByRoute(REGION, 'R1'), 'GHOST'); // in the set, but its key expired

  const res = await request(app)
    .get('/vehicles/live')
    .query({ region: REGION, route: ids.routes.R1 });

  assert.equal(res.status, 200);
  assert.ok(
    res.body.data.vehicles.every((v) => v && v.id !== 'GHOST'),
    'a vehicle whose position expired must not appear',
  );
});

test('a route with realtime on but no buses running is empty and NOT stale', async () => {
  await setRealtime(true);

  const res = await request(app)
    .get('/vehicles/live')
    .query({ region: REGION, route: ids.routes.R2 });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.vehicles, []);
  assert.equal(
    res.body.data.stale,
    false,
    '"no buses right now" is not the same as "feed is broken"',
  );
});

test('live positions are never cached by a proxy', async () => {
  const res = await request(app)
    .get('/vehicles/live')
    .query({ region: REGION, route: ids.routes.R1 });
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('an unknown route is a 404', async () => {
  const res = await request(app).get('/vehicles/live').query({ region: REGION, route: 999999 });

  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'unknown_route');
});

test('a missing route param is a 422', async () => {
  const res = await request(app).get('/vehicles/live').query({ region: REGION });
  assert.equal(res.status, 422);
});

after(async () => {
  const stale = await redis.keys(`*:${REGION}:*`);
  if (stale.length) await redis.del(...stale);
  await dropRegion(REGION);
  await Promise.allSettled([pool.end(), redis.quit()]);
});
