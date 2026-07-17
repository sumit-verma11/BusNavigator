import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { query, pool } from '../../lib/db.js';
import { redis, keys } from '../../lib/redis.js';
import { env } from '../../config/env.js';
import { pollOnce } from './gtfs-rt.js';

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;
const REGION = 'test-rt';
const FEED_URL = 'https://feed.invalid/vehiclepositions';

const realFetch = globalThis.fetch;

/** Encode a real protobuf FeedMessage — decoding a hand-rolled object would prove nothing. */
function encodeFeed(vehicles) {
  const message = FeedMessage.create({
    header: { gtfsRealtimeVersion: '2.0', timestamp: Math.floor(Date.now() / 1000) },
    entity: vehicles.map((v, i) => ({
      id: `e${i}`,
      vehicle: {
        vehicle: { id: v.id },
        trip: { routeId: v.routeId, tripId: v.tripId ?? null },
        position: { latitude: v.lat, longitude: v.lng, bearing: v.bearing ?? 0 },
        timestamp: Math.floor(Date.now() / 1000),
      },
    })),
  });
  return FeedMessage.encode(message).finish();
}

const mockFeed = (vehicles) => {
  globalThis.fetch = async () =>
    new Response(encodeFeed(vehicles), {
      status: 200,
      headers: { 'content-type': 'application/x-protobuf' },
    });
};

const mockFailure = (status = 503) => {
  globalThis.fetch = async () =>
    new Response('upstream exploded', { status, statusText: 'Service Unavailable' });
};

const regionRow = async () =>
  (await query('SELECT id, has_realtime FROM supported_regions WHERE slug = $1', [REGION])).rows[0];

before(async () => {
  const { rows } = await query(
    `INSERT INTO supported_regions (slug, state, city, is_active, has_realtime)
     VALUES ($1, 'Delhi', 'New Delhi', TRUE, FALSE)
     ON CONFLICT (slug) DO UPDATE SET has_realtime = FALSE
     RETURNING id`,
    [REGION],
  );
  await query(`INSERT INTO feed_health (region_id) VALUES ($1) ON CONFLICT DO NOTHING`, [
    rows[0].id,
  ]);
});

beforeEach(async () => {
  const region = await regionRow();
  await query(
    `UPDATE feed_health SET consecutive_failures = 0, last_error = NULL WHERE region_id = $1`,
    [region.id],
  );
});

test('a successful poll writes vehicles to redis and turns has_realtime ON', async () => {
  mockFeed([
    { id: 'BUS1', routeId: 'R1', tripId: 'T1', lat: 28.5483, lng: 77.2513, bearing: 90 },
    { id: 'BUS2', routeId: 'R1', tripId: 'T2', lat: 28.5355, lng: 77.259 },
    { id: 'BUS3', routeId: 'R2', tripId: 'T3', lat: 28.6469, lng: 77.3159 },
  ]);

  const result = await pollOnce({ regionSlug: REGION, url: FEED_URL });
  assert.equal(result.vehicleCount, 3);

  const stored = JSON.parse(await redis.get(keys.vehicle(REGION, 'BUS1')));
  assert.equal(stored.routeId, 'R1');
  assert.equal(Math.round(stored.lat * 1e4) / 1e4, 28.5483);

  const onRoute1 = await redis.smembers(keys.vehiclesByRoute(REGION, 'R1'));
  assert.deepEqual(onRoute1.sort(), ['BUS1', 'BUS2']);

  const region = await regionRow();
  assert.equal(region.has_realtime, true, 'a live feed must enable realtime');
});

test('positions carry a TTL so a dead poller cannot leave ghost buses on the map', async () => {
  mockFeed([{ id: 'BUS1', routeId: 'R1', lat: 28.5, lng: 77.2 }]);
  await pollOnce({ regionSlug: REGION, url: FEED_URL });

  const ttl = await redis.ttl(keys.vehicle(REGION, 'BUS1'));
  assert.ok(
    ttl > 0 && ttl <= (env.GTFS_RT_POLL_INTERVAL_MS / 1000) * 3 + 1,
    `unexpected ttl ${ttl}`,
  );
});

test('a vehicle that leaves a route is removed from that route set', async () => {
  mockFeed([
    { id: 'BUS1', routeId: 'R1', lat: 28.5, lng: 77.2 },
    { id: 'BUS2', routeId: 'R1', lat: 28.6, lng: 77.3 },
  ]);
  await pollOnce({ regionSlug: REGION, url: FEED_URL });

  mockFeed([{ id: 'BUS1', routeId: 'R1', lat: 28.5, lng: 77.2 }]); // BUS2 finished its trip
  await pollOnce({ regionSlug: REGION, url: FEED_URL });

  const onRoute1 = await redis.smembers(keys.vehiclesByRoute(REGION, 'R1'));
  assert.deepEqual(onRoute1, ['BUS1'], 'stale vehicle must not linger on the route');
});

test('a failing feed does not throw — it records failure and keeps the poller alive', async () => {
  mockFailure();
  const result = await pollOnce({ regionSlug: REGION, url: FEED_URL });

  assert.equal(result.vehicleCount, 0);
  assert.equal(result.failures, 1);
  assert.equal(result.disabled, false, 'one blip must not disable realtime');
});

test('failures past the threshold flip has_realtime OFF', async () => {
  mockFeed([{ id: 'BUS1', routeId: 'R1', lat: 28.5, lng: 77.2 }]);
  await pollOnce({ regionSlug: REGION, url: FEED_URL }); // realtime ON

  mockFailure();
  let last;
  for (let i = 0; i < env.GTFS_RT_FAILURE_THRESHOLD; i++) {
    last = await pollOnce({ regionSlug: REGION, url: FEED_URL });
  }

  assert.equal(last.disabled, true);
  const region = await regionRow();
  assert.equal(region.has_realtime, false, 'a dead feed must not silently keep showing buses');
});

test('recovery after an outage turns realtime back ON', async () => {
  mockFeed([{ id: 'BUS9', routeId: 'R9', lat: 28.5, lng: 77.2 }]);
  await pollOnce({ regionSlug: REGION, url: FEED_URL });

  const region = await regionRow();
  assert.equal(region.has_realtime, true);
});

after(async () => {
  globalThis.fetch = realFetch;
  const region = await regionRow();
  if (region) {
    const stale = await redis.keys(`*:${REGION}:*`);
    if (stale.length) await redis.del(...stale);
  }
  await query('DELETE FROM supported_regions WHERE slug = $1', [REGION]);
  await Promise.allSettled([pool.end(), redis.quit()]);
});
