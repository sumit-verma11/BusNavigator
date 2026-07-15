---
name: api-endpoint
description: Scaffold a new BusNavigator API endpoint/module the house way — Zod-validated route, service-layer SQL, AppError handling, and a test. Use whenever adding or changing an endpoint under apps/api (e.g. /stops/nearby, /routes/search, /vehicles/live).
---

# Adding an API endpoint

A module is four files in `apps/api/src/modules/<name>/`. Never put SQL in a route file, never read
`process.env` outside `src/config/env.js`, never skip the schema.

## 1. `<name>.schema.js` — validate at the boundary

Coordinates are untrusted input that reach PostGIS. Bound them.

```js
import { z } from 'zod';

export const nearbyQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().int().min(50).max(5000).default(500), // metres
  limit: z.coerce.number().int().min(1).max(50).default(20),
  region: z.string().min(1).default('delhi'),
});
```

## 2. `<name>.service.js` — parameterised SQL, throw `AppError`

`stops.location` is `geography`, so `ST_DWithin` distances are **metres**. Order by distance and let the
GIST index do the work — no `ORDER BY` on a computed column without the index-friendly operator (`<->`).

```js
import { query } from '../../lib/db.js';
import { AppError } from '../../middleware/error.js';

export async function findNearbyStops({ lat, lng, radius, limit, region }) {
  const { rows } = await query(
    `SELECT s.id, s.gtfs_stop_id, s.name, s.code,
            ST_Y(s.location::geometry) AS lat,
            ST_X(s.location::geometry) AS lng,
            ROUND(ST_Distance(s.location, $1::geography)) AS distance_m
       FROM stops s
       JOIN supported_regions r ON r.id = s.region_id
      WHERE r.slug = $2
        AND r.is_active
        AND ST_DWithin(s.location, $1::geography, $3)
      ORDER BY s.location <-> $1::geography
      LIMIT $4`,
    [`SRID=4326;POINT(${lng} ${lat})`, region, radius, limit],
  );
  return rows;
}
```

Expected failures throw `AppError` (`new AppError('Region not supported', { status: 404, code: 'unknown_region' })`).
Anything else bubbles to the 500 handler with a logged stack — don't catch-and-swallow.

## 3. `<name>.routes.js` — thin

```js
import { Router } from 'express';
import { nearbyQuerySchema } from './stops.schema.js';
import { findNearbyStops } from './stops.service.js';

export const stopsRouter = Router();

stopsRouter.get('/nearby', async (req, res, next) => {
  try {
    const params = nearbyQuerySchema.parse(req.query); // ZodError → 422, handled centrally
    res.json({ data: await findNearbyStops(params) });
  } catch (err) {
    next(err);
  }
});
```

Mount it in `src/app.js` **below** the rate limiter (health checks are the only thing above it).

## 4. `<name>.test.js` — node:test + supertest

Cover the happy path, one validation rejection (422), and the empty result. Tests run against real
Postgres/Redis (`npm run db:up` first), so seed fixtures inside a transaction and roll back.

## Checklist before calling it done

- [ ] Zod schema on every input, with real bounds (not just `z.number()`)
- [ ] Response shape is `{ data }` on success, `{ error: { code, message } }` on failure
- [ ] SQL is parameterised (`$1`), scoped by `region_id`, and hits an index — check with `EXPLAIN ANALYZE`
- [ ] Realtime reads degrade gracefully: if Redis is down or `has_realtime` is false, return schedule data
      plus a `stale: true` flag rather than failing the request
- [ ] Test covers happy path + a 422 + empty result
- [ ] `npm run lint && npm test` pass
