import { env, isProduction } from '../config/env.js';
import { logger } from './logger.js';

/**
 * A seam, not a vendor lock-in.
 *
 * Error tracking is wired at exactly one place so the rest of the codebase never
 * imports a vendor SDK. With no SENTRY_DSN configured this logs and moves on —
 * which means local dev and CI don't need an account, and swapping Sentry for
 * anything else is a change to this file alone.
 *
 * To turn Sentry on: `npm i @sentry/node`, set SENTRY_DSN, and replace the body of
 * `captureException` with `Sentry.captureException(err, { extra: context })`.
 */
const dsn = env.SENTRY_DSN;

export const isErrorTrackingEnabled = Boolean(dsn);

export function captureException(err, context = {}) {
  if (!isErrorTrackingEnabled) {
    // Still structured, still greppable — a missing DSN must not mean a missing error.
    logger.error({ err, ...context, tracking: 'local' }, 'captured exception');
    return;
  }

  logger.error({ err, ...context, tracking: 'sentry' }, 'captured exception');
  // Sentry.captureException(err, { extra: context });
}

if (isProduction && !isErrorTrackingEnabled) {
  logger.warn('SENTRY_DSN is not set — production errors will only reach the logs');
}
