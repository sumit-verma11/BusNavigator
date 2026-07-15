'use client';

import { MapContainer } from '../map/MapContainer.jsx';
import { StaleBanner, LiveBadge, ErrorState } from '../ui/states.jsx';
import { useRouteShape, useLiveVehicles } from '../../lib/queries.js';

/**
 * The live tracking view: the route drawn on the map, with buses moving along it.
 *
 * The realtime contract in one component:
 *   - vehicles present            -> draw them, show "N live"
 *   - stale (feed down / no RT)   -> draw the ROUTE anyway, show the stale banner
 *   - no buses but feed healthy   -> say "no buses running right now" (NOT stale!)
 *
 * The map still renders in every case. A dead feed costs you the buses, not the app.
 */
export function LiveRouteMap({ region, route }) {
  const shape = useRouteShape(route?.id);
  const live = useLiveVehicles({ region, route: route?.id }, { enabled: Boolean(route) });

  if (!route) return null;

  const vehicles = live.data?.vehicles ?? [];
  const stale = live.data?.stale ?? false;
  // A failed poll is itself a stale condition — the last thing we should do is
  // pretend the absence of data means "no buses".
  const degraded = stale || live.isError;

  return (
    <section
      className="flex flex-col gap-3"
      aria-label={`Live tracking for route ${route.shortName}`}
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-title font-semibold">Route {route.shortName}</h2>
        {!degraded && vehicles.length > 0 && <LiveBadge count={vehicles.length} />}
      </div>

      {degraded && (
        <StaleBanner
          message={
            live.data?.message ??
            'Live tracking is unavailable right now — the timetable above is still accurate.'
          }
        />
      )}

      {!degraded && vehicles.length === 0 && (
        <p className="text-small text-muted">
          No buses running on this route right now. The timetable above still applies.
        </p>
      )}

      <div className="h-80 overflow-hidden rounded-lg border border-border md:h-96">
        {shape.isError ? (
          <div className="flex h-full items-center justify-center p-6">
            <ErrorState
              title="No map for this route"
              message="The feed doesn't include a shape for this route yet."
            />
          </div>
        ) : (
          <MapContainer shape={shape.data?.geometry} vehicles={vehicles} />
        )}
      </div>
    </section>
  );
}
