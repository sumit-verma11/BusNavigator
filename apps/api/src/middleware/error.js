import { ZodError } from 'zod';
import { isProduction } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { captureException } from '../lib/monitoring.js';

/** Throw this from services for expected failures; anything else is a 500. */
export class AppError extends Error {
  constructor(message, { status = 400, code = 'bad_request', details } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.path}` } });
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity (4 args)
export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(422).json({
      error: {
        code: 'validation_error',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
  }

  if (err instanceof AppError) {
    return res
      .status(err.status)
      .json({ error: { code: err.code, message: err.message, details: err.details } });
  }

  // Only genuinely unexpected failures reach the tracker. Validation errors and
  // AppErrors are handled above — paging someone because a user typed a bad
  // latitude is how alerts get muted and real outages get missed.
  captureException(err, { path: req.path, method: req.method });

  logger.error({ err, path: req.path }, 'unhandled error');
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: isProduction ? 'Something went wrong' : err.message,
    },
  });
}
