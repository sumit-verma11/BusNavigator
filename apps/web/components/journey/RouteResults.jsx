'use client';

import clsx from 'clsx';
import { Card, RouteBadge } from '../ui/Card.jsx';
import { ListSkeleton, Empty, ErrorState } from '../ui/states.jsx';
import { useRouteSearch } from '../../lib/queries.js';

/**
 * Direct routes between two stops. The v1 promise is deliberately narrow — one bus,
 * no interchanges — so the empty state has to be honest about that rather than
 * implying the journey is impossible.
 */
export function RouteResults({ region, origin, destination, selectedRouteId, onSelect }) {
  const { data, isPending, isError, error, refetch } = useRouteSearch({
    region,
    from: origin?.id,
    to: destination?.id,
  });

  if (!origin || !destination) return null;
  if (isPending) return <ListSkeleton rows={3} />;

  if (isError) {
    return (
      <ErrorState
        title="Couldn't search routes"
        message={error?.message}
        onRetry={() => refetch()}
      />
    );
  }

  if (data.length === 0) {
    return (
      <Empty
        title="No direct bus"
        // Says exactly what we checked and what we didn't. "No routes found" would
        // imply you can't get there at all, which is usually false.
        message={`No single bus runs from ${origin.name} to ${destination.name}. Journeys with a change aren't supported yet — try a nearby stop.`}
      />
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {data.map((route) => {
        const selected = route.id === selectedRouteId;
        const gone = route.nextDepartures.length === 0;

        return (
          <li key={route.id}>
            <Card
              as="button"
              interactive
              onClick={() => onSelect(route)}
              aria-pressed={selected}
              className={clsx(
                'flex w-full items-center gap-4',
                selected && 'border-brand bg-brand-subtle',
              )}
            >
              <RouteBadge shortName={route.shortName} color={route.color} />

              <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
                <p className="truncate text-left font-medium text-ink">
                  {route.longName ?? 'Bus route'}
                </p>

                {gone ? (
                  // NOT the same as "no such route" — the bus exists, it's just done
                  // for the day. Different sentence, because it's a different problem.
                  <p className="text-small text-muted">No more buses today</p>
                ) : (
                  // Departure times as chips: a commuter scans for the next number,
                  // they don't read a sentence.
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-caption text-subtle">Next</span>
                    {route.nextDepartures.map((d) => (
                      <span
                        key={`${d.time}-${d.nextDay}`}
                        className="rounded-sm bg-canvas px-2 py-0.5 font-mono text-caption font-medium text-ink"
                      >
                        {d.time}
                        {d.nextDay && <span className="text-subtle"> +1</span>}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <span className="shrink-0 text-caption text-subtle">
                {route.stopsBetween} {route.stopsBetween === 1 ? 'stop' : 'stops'}
              </span>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
