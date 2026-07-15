'use client';

import { Button } from '../ui/Button.jsx';
import { RegionPicker } from './RegionPicker.jsx';
import { StopAutocomplete } from './StopAutocomplete.jsx';
import { NearbyStops } from './NearbyStops.jsx';
import { RouteResults } from './RouteResults.jsx';
import { LiveRouteMap } from './LiveRouteMap.jsx';
import { useAppStore } from '../../lib/store.js';
import { useRouteSearch } from '../../lib/queries.js';

/**
 * The whole v1 app, in the order a person actually uses it:
 *   which city -> where am I -> where am I going -> which bus -> WHERE IS MY BUS.
 *
 * Single column, mobile-first: the reader is standing at a bus stop, one-handed,
 * probably in the sun. Desktop gets the same column with more room, not a
 * different information architecture.
 */
export function JourneyPlanner() {
  const {
    region,
    origin,
    destination,
    selectedRouteId,
    setRegion,
    setOrigin,
    setDestination,
    selectRoute,
    swapEnds,
    reset,
  } = useAppStore();

  const { data: routes } = useRouteSearch({ region, from: origin?.id, to: destination?.id });
  const selectedRoute = routes?.find((r) => r.id === selectedRouteId) ?? null;
  const hasJourney = Boolean(origin || destination);

  return (
    <div className="min-h-screen bg-canvas">
      {/* Sticky header: the region you're in is context you should never lose. */}
      <header className="sticky top-0 z-20 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3 md:px-6">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand text-inverse"
          >
            🚌
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <h1 className="truncate text-lead font-semibold leading-tight text-ink">
              BusNavigator
            </h1>
            <p className="truncate text-caption text-muted">Delhi buses, live</p>
          </div>
          {hasJourney && (
            <Button variant="ghost" size="sm" onClick={reset}>
              Reset
            </Button>
          )}
        </div>
      </header>

      <main
        id="main"
        className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 pb-24 md:px-6"
      >
        <RegionPicker value={region} onChange={setRegion} />

        {/* The search card. From and To are visually one control joined by a rail,
            because they are one question ("this journey"), not two. */}
        <section
          aria-label="Plan a journey"
          className="rounded-lg border border-border bg-surface p-4 shadow-card"
        >
          <div className="flex gap-3">
            <div aria-hidden="true" className="flex flex-col items-center pt-9">
              <span className="h-2.5 w-2.5 rounded-full border-2 border-brand" />
              <span className="my-1 w-px flex-1 bg-border" />
              <span className="h-2.5 w-2.5 rounded-full bg-brand" />
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <StopAutocomplete
                label="From"
                region={region}
                value={origin}
                onSelect={setOrigin}
                placeholder="Search for a stop…"
              />
              <StopAutocomplete
                label="To"
                region={region}
                value={destination}
                onSelect={setDestination}
                placeholder="Where are you going?"
              />
            </div>

            {origin && destination && (
              <div className="flex items-center">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={swapEnds}
                  aria-label="Swap origin and destination"
                  className="h-11 w-11 px-0 text-lead"
                >
                  ⇅
                </Button>
              </div>
            )}
          </div>
        </section>

        {!origin && (
          <section className="flex flex-col gap-4" aria-label="Stops near you">
            <h2 className="text-title font-semibold">Stops near you</h2>
            <NearbyStops region={region} onPick={setOrigin} />
          </section>
        )}

        {origin && !destination && (
          <p className="px-1 text-body text-muted">
            Now choose where you&apos;re going and we&apos;ll find a direct bus.
          </p>
        )}

        {origin && destination && (
          <section className="flex flex-col gap-4" aria-label="Direct routes">
            <h2 className="text-title font-semibold">Direct buses</h2>
            <RouteResults
              region={region}
              origin={origin}
              destination={destination}
              selectedRouteId={selectedRouteId}
              onSelect={(route) => selectRoute(route.id === selectedRouteId ? null : route.id)}
            />
          </section>
        )}

        {selectedRoute && <LiveRouteMap region={region} route={selectedRoute} />}
      </main>
    </div>
  );
}
