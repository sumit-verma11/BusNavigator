import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';
import { env, isTest } from './config/env.js';
import { logger } from './lib/logger.js';
import { healthRouter } from './modules/health/health.routes.js';
import { regionsRouter } from './modules/regions/regions.routes.js';
import { stopsRouter } from './modules/stops/stops.routes.js';
import { routesRouter } from './modules/routes/routes.routes.js';
import { vehiclesRouter } from './modules/vehicles/vehicles.routes.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1); // behind a load balancer in prod; needed for rate limiting by IP
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()) }));
  app.use(express.json({ limit: '1mb' }));

  if (!isTest) {
    app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url.startsWith('/healthz') } }));
  }

  // Health checks sit above the rate limiter — probes must never be throttled.
  app.use(healthRouter);

  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      limit: env.RATE_LIMIT_MAX,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
  );

  app.use('/regions', regionsRouter);
  app.use('/stops', stopsRouter);
  app.use('/routes', routesRouter);
  app.use('/vehicles', vehiclesRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
