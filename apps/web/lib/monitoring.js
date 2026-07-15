/**
 * The browser half of the seam in `apps/api/src/lib/monitoring.js`.
 *
 * Same rule as the backend: no component ever imports a vendor SDK. With no DSN
 * configured this logs to the console and moves on, so local dev and CI need no
 * account, and swapping Sentry for anything else is a change to this file alone.
 *
 * To turn Sentry on: `npm i @sentry/nextjs`, set NEXT_PUBLIC_SENTRY_DSN, and replace
 * the body of `captureException` with `Sentry.captureException(err, { extra: context })`.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

export const isErrorTrackingEnabled = Boolean(dsn);

/**
 * Expected failures are NOT exceptions. A 404 on an unknown region, a rejected
 * geolocation prompt, a realtime feed that's down — the UI already has a state for
 * each of those, and reporting them would bury the one crash that actually matters.
 * Only errors that reach a boundary (i.e. broke the render) belong here.
 */
export function captureException(err, context = {}) {
  if (!isErrorTrackingEnabled) {
    // The fallback tracker IS the console: a missing DSN must not mean a missing
    // error. This is the one place in the app allowed to say so.
    // eslint-disable-next-line no-console
    console.error('[busnav] captured exception', err, context);
    return;
  }

  // Sentry.captureException(err, { extra: context });
}
