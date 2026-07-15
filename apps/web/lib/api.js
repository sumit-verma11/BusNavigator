/**
 * The API base URL is configuration, never a hardcoded string — same rule as the
 * backend. NEXT_PUBLIC_ is required for anything the browser reads.
 */
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Carries the API's error `code` so the UI can branch on it instead of on strings. */
export class ApiError extends Error {
  constructor(message, { code, status, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function request(path, { signal, ...init } = {}) {
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, { signal, ...init });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    // Offline, DNS failure, API down — the user is standing at a bus stop on
    // patchy 4G, so this is a normal Tuesday, not an exceptional case.
    throw new ApiError('Cannot reach the server. Check your connection.', {
      code: 'network_error',
    });
  }

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const error = body?.error ?? {};
    throw new ApiError(error.message ?? 'Request failed', {
      code: error.code ?? 'unknown_error',
      status: res.status,
      details: error.details,
    });
  }

  return body?.data;
}

const qs = (params) =>
  '?' +
  new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );

export const api = {
  regions: (opts) => request('/regions', opts),

  nearbyStops: ({ region, lat, lng, radius = 800, limit = 20 }, opts) =>
    request(`/stops/nearby${qs({ region, lat, lng, radius, limit })}`, opts),

  searchStops: ({ region, q }, opts) => request(`/stops/search${qs({ region, q })}`, opts),

  searchRoutes: ({ region, from, to }, opts) =>
    request(`/routes/search${qs({ region, from, to })}`, opts),

  routeShape: (routeId, opts) => request(`/routes/${routeId}/shape`, opts),

  liveVehicles: ({ region, route }, opts) =>
    request(`/vehicles/live${qs({ region, route })}`, opts),
};
