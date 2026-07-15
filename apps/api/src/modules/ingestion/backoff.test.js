import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextPollDelay } from './gtfs-rt.js';

const noJitter = { random: () => 0 };

test('a healthy feed keeps its steady cadence', () => {
  assert.equal(nextPollDelay(0, 10_000, noJitter), 10_000);
});

test('failures back off exponentially', () => {
  assert.equal(nextPollDelay(1, 10_000, noJitter), 20_000);
  assert.equal(nextPollDelay(2, 10_000, noJitter), 40_000);
  assert.equal(nextPollDelay(3, 10_000, noJitter), 80_000);
});

test('backoff is capped so a recovered feed is picked up promptly', () => {
  // Without a cap, 20 failures would mean waiting ~4 months for the next poll.
  assert.equal(nextPollDelay(20, 10_000, noJitter), 300_000);
  assert.equal(nextPollDelay(999, 10_000, noJitter), 300_000);
});

test('jitter spreads retries so restarted pollers do not stampede', () => {
  const low = nextPollDelay(2, 10_000, { random: () => 0 });
  const high = nextPollDelay(2, 10_000, { random: () => 1 });

  assert.equal(low, 40_000);
  assert.equal(high, 48_000); // +20%
  assert.ok(high > low, 'jitter must actually vary the delay');
});
