/**
 * GTFS encodes service past midnight as hours >= 24 ('25:10:00' = 1:10am the next
 * morning, still part of the previous service day). We keep that intact in the DB
 * and only normalise it for display here, at the edge.
 */
export function formatDeparture(interval) {
  if (!interval) return null;

  const rawHours = interval.hours ?? 0;
  const minutes = interval.minutes ?? 0;
  const nextDay = rawHours >= 24;
  const hours = rawHours % 24;

  return {
    time: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
    nextDay, // the UI shows "1:10am (+1)" rather than pretending it's today
  };
}

/** Seconds since the start of the service day — how we compare "now" against GTFS times. */
export function toDayInterval(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}
