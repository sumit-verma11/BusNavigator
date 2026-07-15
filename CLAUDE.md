# BusNavigator

Live bus tracking + route search for Delhi. Node/Express API, Postgres+PostGIS, Redis, Next.js web.

Read [ARCHITECTURE.md](ARCHITECTURE.md) for decisions and the build-order roadmap. Read it before proposing a
structural change — most "why not Mongo / why not Redux / why not microservices" questions are answered there.

## Layout

```
apps/api/
  migrations/          SQL migrations (node-pg-migrate). NEVER edit an applied migration — add a new one.
  src/config/env.js    The only module allowed to read process.env. Zod-validated, fails at boot.
  src/lib/             db (pg Pool), redis (ioredis + key builders), logger (pino)
  src/middleware/      error handler + AppError
  src/modules/<name>/  Feature module: <name>.routes.js, <name>.service.js, <name>.schema.js, <name>.test.js
```

## Commands

```bash
npm run db:up          # postgres (postgis) + redis via docker compose
npm run db:migrate     # apply migrations
npm run dev            # api on :4000, watch mode
npm test               # node:test; needs db:up (readyz test hits real pg/redis)
npm run lint           # eslint; npm run format to fix style
npm run db:reset       # nuke volumes, recreate, re-migrate

# ingestion (workspace scripts)
npm run ingest:static --workspace=@busnav/api -- --source <url|file.zip> [--region delhi] [--force]
npm run poll:realtime --workspace=@busnav/api -- [--region delhi]   # long-running
```

Static ingest skips when the feed's content hash is unchanged; pass `--force` to re-ingest anyway.

## Conventions

- **ESM only** (`"type": "module"`), `.js` extensions required in relative imports.
- **No `console.log`** — use `logger` from `src/lib/logger.js`. ESLint fails the build on it.
- **Validate every request** with Zod in `<module>.schema.js`. Lat/lng especially: bounds-check against
  `supported_regions.bbox` — untrusted coordinates reach PostGIS otherwise.
- **Routes are thin.** Parse/validate in the route, do work in `<module>.service.js`, and let the service throw
  `AppError` for expected failures. Unhandled errors become a 500 with a logged stack.
- **SQL lives in the service layer** as parameterised `query()` calls. No ORM, no string-concatenated SQL.
- **Ingestion must be idempotent.** Upsert (`ON CONFLICT ... DO UPDATE`), never blind insert — every ingestion
  script is expected to be safe to re-run.
- Health endpoints must stay above the rate limiter, and `/healthz` must never touch a dependency.

## Web conventions (apps/web)

Next.js App Router, plain JSX (no TS — matches the API; revisit only if the team grows).

- **Never invent a colour, spacing value, or font size.** If it isn't a token in `tailwind.config.js`, it doesn't
  ship. Tailwind's default palette is deliberately replaced, so `bg-blue-400` will simply not compile.
- **Every data-dependent surface renders one of the four states** from `components/ui/states.jsx` —
  `ListSkeleton` / `Empty` / `ErrorState` / `StaleBanner`. Never a blank div, never a spinner-forever.
  See them all at `/design-system`.
- **Anything that can throw during render gets an `ErrorBoundary` scoped tightly around it** — the map already
  has one. A throw with no boundary unmounts the whole app; a boundary around the whole page is just as bad, so
  wrap the risky part, not its parent. Pass `resetKeys` or the fallback becomes permanent. Report crashes via
  `lib/monitoring.js` — never import a vendor SDK in a component, and never report an expected failure
  (bad input, denied geolocation, dead RT feed) that already has a state.
- **Never re-render the map to move a bus.** `MapView` owns MapLibre imperatively; vehicle updates call
  `marker.setLngLat()`. Do not lift vehicles into React-rendered markers.
- **Server state → TanStack Query. Client state → Zustand.** The store holds what the _user picked_, nothing
  the server said. If you're tempted to cache API data in Zustand, use a query instead.
- Map components are lazy-loaded with `ssr: false` — keep it that way; MapLibre must stay out of first load.

## API contracts worth not breaking

- `{ data }` on success, `{ error: { code, message } }` on failure. Every endpoint, no exceptions.
- `/vehicles/live` **must never 5xx because realtime is unavailable.** Feed down, Redis down, region without
  realtime: return 200 + `stale: true` + a reason. The timetable still works; the UI shows a banner.
- `/routes/search` returns a route with empty `nextDepartures` when the last bus has gone. That is NOT the same
  as returning no routes — the frontend renders different empty states for the two.
- `searchDirectRoutes` takes an injectable `now`. Use it in tests; never assert against the wall clock.

## Gotchas that have already bitten this schema

- GTFS times exceed 24h (`25:10:00` = next-morning service). `stop_times` columns are `INTERVAL`, not `TIME`.
- `stops.location` is `geography`, so `ST_DWithin(location, point, 500)` is **500 metres**. With `geometry` it
  would be 500 _degrees_. Don't "simplify" the column type.
- GTFS ids are unique per-feed, not globally. Always scope by `region_id`.
