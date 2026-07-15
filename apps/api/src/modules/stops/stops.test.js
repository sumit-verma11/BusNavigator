import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../app.js';
import { pool } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';
import { seedRegion, dropRegion } from '../../test-utils/gtfs-fixture.js';

const REGION = 'test-stops';
const app = createApp();

before(async () => {
  await seedRegion(REGION);
});

test('finds stops near a coordinate, nearest first, with distance', async () => {
  // Standing at Nehru Place, 2km radius reaches Kalkaji but not Anand Vihar (~13km).
  const res = await request(app)
    .get('/stops/nearby')
    .query({ region: REGION, lat: 28.5483, lng: 77.2513, radius: 2000 });

  assert.equal(res.status, 200);
  const names = res.body.data.map((s) => s.name);
  assert.deepEqual(names, ['Nehru Place', 'Kalkaji Mandir'], 'must be ordered by distance');
  assert.equal(res.body.data[0].distance_m, 0);
  assert.ok(res.body.data[1].distance_m > 1000 && res.body.data[1].distance_m < 2000);
});

test('nearby includes the routes serving each stop', async () => {
  const res = await request(app)
    .get('/stops/nearby')
    .query({ region: REGION, lat: 28.5483, lng: 77.2513, radius: 500 });

  assert.deepEqual(res.body.data[0].routes.sort(), ['500', '764']);
});

test('a tight radius returns an empty list, not an error', async () => {
  const res = await request(app)
    .get('/stops/nearby')
    .query({ region: REGION, lat: 28.5483, lng: 77.2513, radius: 50 });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 1); // only the stop you're standing on
});

test('rejects coordinates outside the region rather than querying PostGIS', async () => {
  const res = await request(app)
    .get('/stops/nearby')
    .query({ region: REGION, lat: 19.076, lng: 72.8777 }); // Mumbai

  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'out_of_region');
});

test('rejects a malformed latitude with a 422 and a useful path', async () => {
  const res = await request(app)
    .get('/stops/nearby')
    .query({ region: REGION, lat: 999, lng: 77.2513 });

  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'validation_error');
  assert.equal(res.body.error.details[0].path, 'lat');
});

test('rejects an unbounded radius', async () => {
  const res = await request(app)
    .get('/stops/nearby')
    .query({ region: REGION, lat: 28.5483, lng: 77.2513, radius: 500000 });

  assert.equal(res.status, 422);
});

test('unknown region is a 404, not an empty list', async () => {
  const res = await request(app)
    .get('/stops/nearby')
    .query({ region: 'atlantis', lat: 28.5483, lng: 77.2513 });

  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'unknown_region');
});

test('autocomplete matches on a partial, misspelt stop name', async () => {
  const res = await request(app).get('/stops/search').query({ region: REGION, q: 'kalkaji' });

  assert.equal(res.status, 200);
  assert.equal(res.body.data[0].name, 'Kalkaji Mandir');
});

test('autocomplete rejects a single-character query', async () => {
  const res = await request(app).get('/stops/search').query({ region: REGION, q: 'k' });
  assert.equal(res.status, 422);
});

after(async () => {
  await dropRegion(REGION);
  await Promise.allSettled([pool.end(), redis.quit()]);
});
