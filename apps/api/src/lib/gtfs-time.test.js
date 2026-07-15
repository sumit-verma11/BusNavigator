import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDeparture, toDayInterval } from './gtfs-time.js';

test('formats an ordinary departure', () => {
  assert.deepEqual(formatDeparture({ hours: 6, minutes: 5 }), { time: '06:05', nextDay: false });
});

test('normalises past-midnight GTFS times for display', () => {
  // 25:10 on the service day is 1:10am the following morning. Showing "25:10" to a
  // user is nonsense; showing "01:10" without a +1 sends them out 24 hours late.
  assert.deepEqual(formatDeparture({ hours: 25, minutes: 10 }), { time: '01:10', nextDay: true });
  assert.deepEqual(formatDeparture({ hours: 24, minutes: 5 }), { time: '00:05', nextDay: true });
});

test('treats an interval with no hours field as midnight', () => {
  assert.deepEqual(formatDeparture({ minutes: 30 }), { time: '00:30', nextDay: false });
});

test('returns null for a missing time rather than throwing', () => {
  assert.equal(formatDeparture(null), null);
});

test('renders the current time as a zero-padded day interval', () => {
  assert.equal(toDayInterval(new Date(2026, 0, 1, 7, 5, 9)), '07:05:09');
});
