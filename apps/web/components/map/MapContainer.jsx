'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '../ui/states.jsx';
import { ErrorBoundary } from '../ui/ErrorBoundary.jsx';

/**
 * MapLibre is ~200KB of JS that cannot run on the server and that nobody needs
 * until the map is actually on screen. Lazy-loaded with `ssr: false` so it never
 * blocks first paint — the region picker and stop list render instantly without it.
 */
const MapView = dynamic(() => import('./MapView.jsx'), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-none" />,
});

/**
 * The map is the ONLY part of this app that can hard-throw during render, and it is
 * also the least essential: `new maplibregl.Map()` throws outright on a device with no
 * WebGL context (old Android, locked-down browser, GPU blocklist), and that throw
 * happens in an effect — which React forwards straight to the nearest boundary.
 *
 * With no boundary here, the nearest one is the route's, so a phone that can't do
 * WebGL loses the whole journey planner instead of just the picture of it. That is a
 * blank screen for the person who most needs the timetable.
 *
 * Same principle as `/vehicles/live` never 5xx-ing because realtime is down: a dead
 * map costs you the map, not the app. The route list above it keeps working.
 */
export function MapContainer({ className = 'h-full w-full', ...props }) {
  return (
    <div className={className}>
      <ErrorBoundary
        name="map"
        // Re-arm on a new route: a boundary that caught once must not keep showing the
        // fallback for a route that would render fine.
        resetKeys={[props.shape]}
        fallback={() => (
          <div className="flex h-full flex-col items-center justify-center gap-2 bg-raised p-6 text-center">
            <span aria-hidden="true" className="text-2xl opacity-70">
              🗺️
            </span>
            <p className="text-small font-medium text-ink">The map couldn&apos;t load</p>
            <p className="max-w-xs text-caption text-muted">
              Your browser may not support maps. Stops and departure times are all listed above —
              nothing else is affected.
            </p>
          </div>
        )}
      >
        <MapView {...props} />
      </ErrorBoundary>
    </div>
  );
}
