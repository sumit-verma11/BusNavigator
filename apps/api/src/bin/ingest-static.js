#!/usr/bin/env node
// Usage: npm run ingest:static -- [--region delhi] [--source <url|path.zip>] [--force]
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { pool } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { ingestStaticFeed } from '../modules/ingestion/gtfs-static.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const regionSlug = flag('region', 'delhi');
const source = flag('source', env.GTFS_STATIC_URL);
const force = args.includes('--force');

if (!source) {
  logger.fatal('No feed source. Set GTFS_STATIC_URL or pass --source <url|path.zip>');
  process.exit(1);
}

try {
  const result = await ingestStaticFeed({ regionSlug, source, force });
  logger.info(result, 'ingest complete');
  process.exitCode = 0;
} catch (err) {
  logger.fatal({ err }, 'ingest failed');
  process.exitCode = 1;
} finally {
  await Promise.allSettled([pool.end(), redis.quit()]);
}
