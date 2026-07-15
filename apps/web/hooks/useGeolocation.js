'use client';

import { useCallback, useState } from 'react';

/**
 * Geolocation is a PERMISSION FLOW, not a value.
 *
 * Every one of these states is a real thing that happens to real users, and each
 * needs its own UI: the browser can't do it, the user hasn't been asked yet, the
 * prompt is open, they said no, or the fix failed. Treating this as "lat/lng or
 * undefined" is how you end up with a screen that silently shows nothing forever.
 */
export function useGeolocation() {
  // Initial state must NOT depend on `navigator`: the server has no navigator, so
  // seeding from it renders "unsupported" on the server and "idle" on the client —
  // a hydration mismatch that makes React throw the server HTML away.
  //
  // Support is only ever interesting at the moment the user asks for their location,
  // and `request()` already handles the unsupported case — so there is nothing to
  // detect on mount, and no effect to write.
  const [state, setState] = useState({ status: 'idle', coords: null, error: null });

  const request = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setState({ status: 'unsupported', coords: null, error: null });
      return;
    }

    setState((s) => ({ ...s, status: 'pending', error: null }));

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setState({
          status: 'granted',
          coords: { lat: position.coords.latitude, lng: position.coords.longitude },
          error: null,
        });
      },
      (error) => {
        // PERMISSION_DENIED is not an error to apologise for — the user made a
        // choice, and the app must keep working via manual search.
        setState({
          status: error.code === error.PERMISSION_DENIED ? 'denied' : 'error',
          coords: null,
          error: error.message,
        });
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }, []);

  return { ...state, request };
}
