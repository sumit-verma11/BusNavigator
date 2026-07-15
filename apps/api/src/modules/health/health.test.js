import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../app.js';
import { pool } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';

const app = createApp();

test('GET /healthz returns 200 without touching dependencies', async () => {
  const res = await request(app).get('/healthz');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(typeof res.body.uptime, 'number');
});

test('GET /readyz reports postgres and redis', async () => {
  const res = await request(app).get('/readyz');
  assert.equal(res.status, 200);
  assert.equal(res.body.checks.postgres, 'ok');
  assert.equal(res.body.checks.redis, 'ok');
  assert.equal(res.body.status, 'ok');
});

test('unknown route returns a structured 404', async () => {
  const res = await request(app).get('/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'not_found');
});

after(async () => {
  await Promise.allSettled([pool.end(), redis.quit()]);
});
