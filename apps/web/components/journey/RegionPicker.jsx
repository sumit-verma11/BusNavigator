'use client';

import { useMemo } from 'react';
import { Select } from '../ui/Select.jsx';
import { Skeleton } from '../ui/states.jsx';
import { useRegions } from '../../lib/queries.js';

/**
 * State -> city, as two dependent dropdowns.
 *
 * A city listed here means "we support this city", NOT "we have its timetable".
 * Cities without an ingested GTFS feed are marked and, when picked, the app says
 * so plainly — showing an empty stop list would make the user think the app is
 * broken, or that the city has no buses.
 */
export function RegionPicker({ value, onChange }) {
  const { data: regions, isPending, isError } = useRegions();

  const byState = useMemo(() => {
    const map = new Map();
    for (const r of regions ?? []) {
      if (!map.has(r.state)) map.set(r.state, []);
      map.get(r.state).push(r);
    }
    return map;
  }, [regions]);

  if (isPending) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  }

  // Region list unavailable: don't block the app — the store already defaults to Delhi.
  if (isError || !regions?.length) return null;

  const current = regions.find((r) => r.slug === value) ?? regions[0];
  const citiesInState = byState.get(current.state) ?? [];

  const onStateChange = (state) => {
    const cities = byState.get(state) ?? [];
    // Prefer a city we actually have data for, so switching state lands somewhere useful.
    const next = cities.find((c) => c.has_data) ?? cities[0];
    if (next) onChange(next.slug);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3">
        <Select
          name="state"
          label="State"
          value={current.state}
          onChange={(e) => onStateChange(e.target.value)}
        >
          {[...byState.keys()].map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </Select>

        <Select
          name="region"
          label="City"
          value={current.slug}
          onChange={(e) => onChange(e.target.value)}
        >
          {citiesInState.map((city) => (
            <option key={city.slug} value={city.slug}>
              {city.city}
              {city.has_data ? '' : ' (coming soon)'}
            </option>
          ))}
        </Select>
      </div>

      {!current.has_data ? (
        <p
          role="status"
          className="rounded-md border border-stale bg-stale-subtle px-3 py-2 text-caption text-ink"
        >
          We don&apos;t have timetable data for {current.city} yet — no GTFS feed is loaded for this
          city. Delhi is the only city with data today.
        </p>
      ) : (
        !current.has_realtime && (
          <p className="px-1 text-caption text-muted">
            Timetables only — live bus positions aren&apos;t available here yet.
          </p>
        )
      )}
    </div>
  );
}
