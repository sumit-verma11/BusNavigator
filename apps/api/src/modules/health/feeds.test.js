import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../app.js';
import { query, pool } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';

const REGION = 'test-feeds';
const app = createApp();
let regionId;

const setFeed = ({ hasRealtime, lastSuccessAt, failures = 0 }) =>
  Promise.all([
    query('UPDATE supported_regions SET has_realtime = $2 WHERE id = $1', [regionId, hasRealtime]),
    query(
      `UPDATE feed_health
          SET last_success_at = $2, consecutive_failures = $3
        WHERE region_id = $1`,
      [regionId, lastSuccessAt, failures],
    ),
  ]);

const feedFor = async (slug) => {
  const res = await request(app).get('/healthz/feeds');
  return { res, feed: res.body.feeds.find((f) => f.region === slug) };
};

before(async () => {
  const { rows } = await query(
    `INSERT INTO supported_regions (slug, state, city, is_active, has_realtime)
     VALUES ($1, 'Delhi', 'New Delhi', TRUE, FALSE)
     ON CONFLICT (slug) DO UPDATE SET is_active = TRUE
     RETURNING id`,
    [REGION],
  );
  regionId = rows[0].id;
  await query('INSERT INTO feed_health (region_id) VALUES ($1) ON CONFLICT DO NOTHING', [regionId]);
});

test('a region without realtime is not unhealthy — we never promised live data', async () => {
  await setFeed({ hasRealtime: false, lastSuccessAt: null });

  const { feed } = await feedFor(REGION);
  assert.equal(feed.realtimeEnabled, false);
  assert.equal(feed.healthy, true, 'no promise means no broken promise');
});

test('a recently-polled realtime feed is healthy', async () => {
  await setFeed({ hasRealtime: true, lastSuccessAt: new Date() });

  const { feed } = await feedFor(REGION);
  assert.equal(feed.healthy, true);
  assert.ok(feed.secondsSinceSuccess < 5);
});

test('a realtime feed that stopped polling goes unhealthy and the endpoint 503s', async () => {
  // The silent failure this endpoint exists to catch: the API is fine, the poller
  // died an hour ago, and every user is quietly looking at stale data.
  await setFeed({
    hasRealtime: true,
    lastSuccessAt: new Date(Date.now() - 60 * 60 * 1000),
    failures: 12,
  });

  const { res, feed } = await feedFor(REGION);
  assert.equal(res.status, 503, 'an uptime monitor must be able to see this');
  assert.equal(res.body.status, 'degraded');
  assert.equal(feed.healthy, false);
  assert.equal(feed.consecutiveFailures, 12);
});

test('a realtime region that has NEVER polled successfully is unhealthy', async () => {
  await setFeed({ hasRealtime: true, lastSuccessAt: null });

  const { res, feed } = await feedFor(REGION);
  assert.equal(res.status, 503);
  assert.equal(feed.healthy, false);
  assert.equal(feed.secondsSinceSuccess, null);
});

after(async () => {
  await query('DELETE FROM supported_regions WHERE slug = $1', [REGION]);
  await Promise.allSettled([pool.end(), redis.quit()]);
});
