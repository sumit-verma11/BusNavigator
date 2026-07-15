'use client';

import { Button } from '../ui/Button.jsx';
import { Card } from '../ui/Card.jsx';
import { ListSkeleton, Empty, ErrorState } from '../ui/states.jsx';
import { useNearbyStops } from '../../lib/queries.js';
import { useGeolocation } from '../../hooks/useGeolocation.js';

/**
 * "What's near me" — the screen someone opens while a bus is pulling away.
 *
 * The permission flow gets as much care as the happy path, because refusing
 * location is COMMON and must not be a dead end: every denied/unsupported branch
 * still leaves the user with a working app (search by name instead).
 */
export function NearbyStops({ region, onPick }) {
  const geo = useGeolocation();
  const { data, isPending, isError, error, refetch } = useNearbyStops({
    region,
    lat: geo.coords?.lat,
    lng: geo.coords?.lng,
    radius: 800,
  });

  if (geo.status === 'idle') {
    return (
      <Empty
        title="Find stops near you"
        message="We'll use your location to show the closest bus stops. It never leaves your device except to look up stops."
        action={<Button onClick={geo.request}>Use my location</Button>}
      />
    );
  }

  if (geo.status === 'pending') return <ListSkeleton rows={3} />;

  if (geo.status === 'denied') {
    return (
      <Empty
        title="Location is off"
        message="No problem — search for your stop by name above instead."
        action={
          <Button variant="secondary" size="sm" onClick={geo.request}>
            Try location again
          </Button>
        }
      />
    );
  }

  if (geo.status === 'unsupported' || geo.status === 'error') {
    return (
      <Empty
        title="Can't get your location"
        message="Your browser didn't provide a location. Search for your stop by name above."
      />
    );
  }

  if (isPending) return <ListSkeleton rows={3} />;

  if (isError) {
    return (
      <ErrorState
        title="Couldn't load nearby stops"
        message={error?.message}
        onRetry={() => refetch()}
      />
    );
  }

  if (data.length === 0) {
    return (
      <Empty
        title="No stops within 800m"
        message="You may be outside the area we cover, or between routes. Try searching by name."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {data.map((stop) => (
        <li key={stop.id}>
          <Card
            as="button"
            interactive
            onClick={() => onPick(stop)}
            className="flex w-full items-center gap-4"
          >
            <div className="flex flex-1 flex-col items-start gap-1">
              <p className="font-medium text-ink">{stop.name}</p>
              <p className="text-small text-muted">
                {stop.distance_m} m away
                {stop.routes?.length > 0 && ` · ${stop.routes.slice(0, 4).join(', ')}`}
              </p>
            </div>
            <span aria-hidden="true" className="text-muted">
              →
            </span>
          </Card>
        </li>
      ))}
    </ul>
  );
}
