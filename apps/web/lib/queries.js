'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api.js';

/**
 * Server state lives in TanStack Query; only genuine UI state goes in Zustand.
 * That split is why this app doesn't need Redux: almost nothing here is client state.
 */

export const keys = {
  regions: ['regions'],
  nearby: (p) => ['stops', 'nearby', p],
  stopSearch: (p) => ['stops', 'search', p],
  routeSearch: (p) => ['routes', 'search', p],
  routeShape: (region, id) => ['routes', 'shape', region, id],
  vehicles: (p) => ['vehicles', 'live', p],
};

export function useRegions() {
  return useQuery({
    queryKey: keys.regions,
    queryFn: ({ signal }) => api.regions({ signal }),
    staleTime: 60 * 60 * 1000, // the list of supported cities changes ~never
  });
}

export function useNearbyStops(params) {
  return useQuery({
    queryKey: keys.nearby(params),
    queryFn: ({ signal }) => api.nearbyStops(params, { signal }),
    enabled: Boolean(params?.lat && params?.lng),
    staleTime: 5 * 60 * 1000, // bus stops don't move
  });
}

export function useStopSearch(params) {
  return useQuery({
    queryKey: keys.stopSearch(params),
    queryFn: ({ signal }) => api.searchStops(params, { signal }),
    // Autocomplete is debounced by the caller; this is the second line of defence.
    enabled: (params?.q?.length ?? 0) >= 2,
    staleTime: 60 * 1000,
  });
}

export function useRouteSearch(params) {
  return useQuery({
    queryKey: keys.routeSearch(params),
    queryFn: ({ signal }) => api.searchRoutes(params, { signal }),
    enabled: Boolean(params?.from && params?.to && params.from !== params.to),
  });
}

export function useRouteShape(region, routeId) {
  return useQuery({
    queryKey: keys.routeShape(region, routeId),
    queryFn: ({ signal }) => api.routeShape({ region, routeId }, { signal }),
    enabled: Boolean(routeId),
    staleTime: 24 * 60 * 60 * 1000, // a route's geometry is effectively static
    retry: false, // a route with no shape is a 404, not a transient failure
  });
}

/**
 * The only polling query in the app.
 *
 * - Polls every 10s, matching the poller's own cadence — asking faster just burns
 *   the user's battery and data for numbers that haven't changed.
 * - `refetchIntervalInBackground: false`: a phone in a pocket must not poll. This
 *   single line is the difference between a normal app and a battery complaint.
 * - `placeholderData: keepPreviousData` so buses don't vanish and re-appear on each
 *   tick — the markers move instead of flickering.
 */
export function useLiveVehicles(params, { enabled = true } = {}) {
  return useQuery({
    queryKey: keys.vehicles(params),
    queryFn: ({ signal }) => api.liveVehicles(params, { signal }),
    enabled: enabled && Boolean(params?.route),
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    placeholderData: (previous) => previous,
    retry: 1,
  });
}
