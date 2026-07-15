import pino from 'pino';
import { env, isProduction } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  // JSON in prod (machine-parseable), human-readable locally.
  transport: isProduction ? undefined : { target: 'pino-pretty', options: { colorize: true } },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.apiKey', '*.password'],
    remove: true,
  },
  base: { service: 'busnav-api', env: env.NODE_ENV },
});

export const childLogger = (bindings) => logger.child(bindings);
