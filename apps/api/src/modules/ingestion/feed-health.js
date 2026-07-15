import { query } from '../../lib/db.js';
import { redis, keys } from '../../lib/redis.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ module: 'feed-health' });

/**
 * Feed health is a first-class feature, not an afterthought: a realtime feed that
 * dies quietly is worse than one that dies loudly, because the UI keeps drawing
 * buses that are no longer there. A successful poll turns realtime ON; enough
 * consecutive failures turn it OFF, and the frontend shows a stale-data banner.
 */

export async function recordPollSuccess(regionId, vehicleCount) {
  const { rows } = await query(
    `UPDATE feed_health
        SET last_success_at = now(),
            consecutive_failures = 0,
            last_error = NULL,
            vehicle_count = $2,
            updated_at = now()
      WHERE region_id = $1
      RETURNING region_id`,
    [regionId, vehicleCount],
  );

  if (rows.length === 0) {
    await query(
      `INSERT INTO feed_health (region_id, last_success_at, vehicle_count)
       VALUES ($1, now(), $2)
       ON CONFLICT (region_id) DO NOTHING`,
      [regionId, vehicleCount],
    );
  }

  const { rows: flipped } = await query(
    `UPDATE supported_regions
        SET has_realtime = TRUE, updated_at = now()
      WHERE id = $1 AND has_realtime = FALSE
      RETURNING slug`,
    [regionId],
  );

  if (flipped.length > 0) {
    log.info({ regionId, slug: flipped[0].slug }, 'realtime feed recovered — has_realtime ON');
  }

  return { vehicleCount };
}

export async function recordPollFailure(regionId, error) {
  const { rows } = await query(
    `UPDATE feed_health
        SET last_failure_at = now(),
            consecutive_failures = consecutive_failures + 1,
            last_error = $2,
            updated_at = now()
      WHERE region_id = $1
      RETURNING consecutive_failures`,
    [regionId, String(error?.message ?? error).slice(0, 500)],
  );

  const failures = rows[0]?.consecutive_failures ?? 0;

  // Below the threshold this is a blip (feeds flake constantly); above it, the
  // feed is genuinely down and we must stop pretending otherwise.
  if (failures >= env.GTFS_RT_FAILURE_THRESHOLD) {
    const { rows: flipped } = await query(
      `UPDATE supported_regions
          SET has_realtime = FALSE, updated_at = now()
        WHERE id = $1 AND has_realtime = TRUE
        RETURNING slug`,
      [regionId],
    );

    if (flipped.length > 0) {
      log.error(
        { regionId, slug: flipped[0].slug, failures, err: error?.message },
        'realtime feed down past threshold — has_realtime OFF, serving schedule only',
      );
    }
  } else {
    log.warn({ regionId, failures, err: error?.message }, 'realtime poll failed');
  }

  return { failures, disabled: failures >= env.GTFS_RT_FAILURE_THRESHOLD };
}

/** Cached snapshot for the API to stamp `stale: true` on responses without a DB hit. */
export async function publishHealthSnapshot(regionSlug, snapshot) {
  await redis.set(keys.feedHealth(regionSlug), JSON.stringify(snapshot), 'EX', 300);
}
