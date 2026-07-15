#!/usr/bin/env node
// Long-running process. Deploy it separately from the API and put uptime
// monitoring on it — it is the single point of silent failure in this system.
import { logger } from '../lib/logger.js';
import { pool } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { startPoller } from '../modules/ingestion/gtfs-rt.js';

// Region comes from argv, not process.env: config/env.js is the only module that
// reads the environment, and one poller process serves one region.
const args = process.argv.slice(2);
const regionIdx = args.indexOf('--region');
const regionSlug = regionIdx === -1 ? 'delhi' : args[regionIdx + 1];

const stop = startPoller({ regionSlug });

async function shutdown(signal) {
  logger.info({ signal }, 'poller shutting down');
  stop();
  await Promise.allSettled([pool.end(), redis.quit()]);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
