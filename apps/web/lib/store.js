'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Client state ONLY — what the user picked, not what the server said. Everything
 * server-shaped (stops, routes, vehicles) belongs to TanStack Query. Keeping that
 * line clean is what stops this store from turning into a cache nobody invalidates.
 */
export const useAppStore = create(
  persist(
    (set) => ({
      region: 'delhi',
      origin: null, // { id, name }
      destination: null,
      selectedRouteId: null,

      setRegion: (region) =>
        set({ region, origin: null, destination: null, selectedRouteId: null }),
      setOrigin: (origin) => set({ origin, selectedRouteId: null }),
      setDestination: (destination) => set({ destination, selectedRouteId: null }),
      selectRoute: (selectedRouteId) => set({ selectedRouteId }),
      swapEnds: () => set((s) => ({ origin: s.destination, destination: s.origin })),
      reset: () => set({ origin: null, destination: null, selectedRouteId: null }),
    }),
    {
      name: 'busnav',
      // Only the region survives a reload. Restoring a half-finished journey search
      // from three days ago would be confusing, not helpful.
      partialize: (s) => ({ region: s.region }),
    },
  ),
);
