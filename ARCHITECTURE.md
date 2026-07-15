# BusNavigator — Architecture & Build Plan

Live bus tracking and route search. **v1 scope: Delhi only, direct routes only.**

## 1. Decisions (locked — expensive to change later)

| Area         | Choice                                               | Why                                                                                                                                                  |
| ------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Backend**  | Node + Express, modular services in one deployable   | Split into microservices only when load demands it. Module boundaries now make that split cheap later.                                               |
| **Database** | Postgres + PostGIS                                   | Geospatial queries + relational joins (stops↔trips↔routes) are exactly what this is built for. Mongo would cost more engineering time than it saves. |
| **Cache**    | Redis                                                | Live vehicle state (ephemeral, high write rate) and response caching. Never the source of truth.                                                     |
| **Frontend** | Next.js + TanStack Query + Zustand                   | SSR for landing/search (SEO, first load). App state is mostly _server_ state — Redux is the wrong tool here.                                         |
| **Infra**    | Docker Compose local; managed Postgres/Redis in prod | Don't self-host stateful services on day one. App containers stay stateless so they scale horizontally.                                              |

### Non-negotiables from day one

- **Env-based config.** No hardcoded keys/URLs. `apps/api/src/config/env.js` is the only module that reads `process.env`; it validates with Zod and fails at boot, not at 3am.
- **Structured logging.** pino, JSON in prod. No `console.log` (ESLint enforces this).
- **Health endpoints.** `/healthz` (liveness, no dependency calls) and `/readyz` (readiness; Postgres required, Redis degraded-but-serveable).
- **CI on every PR.** Lint + format + migrations + tests. Solo dev is exactly when regression-catching matters most.

## 2. Build order

| Step  | What                                                                                                                                               | Status  |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **1** | Repo + infra skeleton: workspaces, ESLint/Prettier/Husky, Compose (PostGIS + Redis), `/healthz`                                                    | ✅ done |
| **2** | Schema + migrations: regions, GTFS core, feed health. GIST on geometry, B-tree on FKs                                                              | ✅ done |
| **3** | Ingestion: idempotent GTFS static parser + GTFS-RT poller → Redis + feed-health flip                                                               | ✅ done |
| **4** | API layer: `/regions`, `/stops/nearby`, `/routes/search`, `/routes/:id/shape`, `/vehicles/live` — Zod validation + rate limiting on every endpoint | ✅ done |
| **5** | Frontend foundation: design tokens + component library **before** any real screen                                                                  | ✅ done |
| **6** | Screens: region selector → map + nearby stops → route search → live tracking overlay                                                               | ✅ done |
| **7** | Hardening: error boundaries, skeletons, empty states, stale-data banners, backoff, Sentry                                                          | ✅ done |
| **8** | Deploy: staging → smoke-test real Delhi routes → prod. Uptime monitoring **on the poller**                                                         | next    |

Step 3 is the foundation everything else depends on, and the poller is the single point of _silent_ failure — hence `feed_health` being a first-class table rather than an afterthought.

### Ingestion design (Step 3, as built)

Two processes, deployed separately from the API:

- **`ingest:static`** (cron, e.g. nightly). Downloads the feed, hashes it, and **skips entirely if the content hash matches the last successful import** — re-running is free, not a 200k-row rewrite. Everything else is an upsert on `(region_id, gtfs_*_id)` inside one transaction, so a crashed run rolls back and a retry converges rather than duplicating. Every attempt is audited in `feed_imports` (succeeded / skipped / failed, with row counts).
- **`poll:realtime`** (long-running). Fetches GTFS-RT protobuf every `GTFS_RT_POLL_INTERVAL_MS`, writes vehicle positions to **Redis only** — they're ephemeral, rewritten every few seconds, and worthless in 30s; putting them in Postgres would mean thousands of UPDATEs a minute for data nobody will ever query historically.

Three failure modes are designed out rather than hoped away:

1. **Ghost buses.** Every Redis position carries a TTL of 3× the poll interval, so a poller that dies cannot leave stale buses frozen on the map forever.
2. **Vehicles that never leave a route.** Each route's member set is rebuilt per poll (`DEL` + `SADD`), because `SADD` alone can only ever add — a bus that finished its trip would otherwise sit on that route permanently.
3. **Silent staleness.** Consecutive failures past `GTFS_RT_FAILURE_THRESHOLD` flip `supported_regions.has_realtime` to `FALSE`, and a successful poll flips it back. The frontend keys its stale-data banner off that flag. **A quietly dead feed is worse than a visible outage** — this is the whole reason feed health is modelled in the DB.

**Put uptime monitoring on the poller specifically.** The API can be perfectly healthy while the poller is dead, and only `feed_health.last_success_at` will know.

## 3. Schema notes (the non-obvious parts)

- **`stops.location` is `geography(Point,4326)`, not `geometry`** — so `ST_DWithin` takes metres directly. Nearby-stop queries are the #1 read path; GIST index is mandatory, not optional.
- **`stop_times.arrival_time` is `INTERVAL`, not `TIME`** — GTFS legally encodes past-midnight service as `25:10:00`. `TIME` rejects it and you lose the night buses.
- **Surrogate int PKs + `(region_id, gtfs_*_id)` unique keys** — GTFS ids are only unique _within a feed_, and int joins beat text joins on a table with millions of `stop_times` rows.
- **`shapes` is one row per shape** (LineString), not one row per point. Re-assembling points at query time is a needless sort.
- **`feed_imports.content_hash`** makes re-ingestion idempotent: same hash → skip, don't re-upsert 40k rows.
- **`supported_regions.has_realtime`** is flipped **off automatically** after `GTFS_RT_FAILURE_THRESHOLD` consecutive poll failures. Silent stale data is worse than a visible outage banner.

### API surface (Step 4, as built)

All responses are `{ data }` on success and `{ error: { code, message, details? } }` on failure. Every input is Zod-validated; every region-scoped route 404s on an unknown region rather than returning an empty list — "no buses here" and "that city doesn't exist" are different answers.

| Endpoint                | Notes                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET /regions`          | Region picker. Includes `has_realtime` so the UI knows whether to promise live tracking.                      |
| `GET /stops/nearby`     | `lat`, `lng`, `radius` (50–5000m, **bounded**), `limit`. Rejects coordinates outside the region's bbox (422). |
| `GET /stops/search`     | Trigram autocomplete, min 2 chars. Debounce on the client.                                                    |
| `GET /routes/search`    | `from`/`to` stop ids. **Direct routes only.** Returns the route even when no departures remain today.         |
| `GET /routes/:id/shape` | GeoJSON LineString, straight into the map layer.                                                              |
| `GET /vehicles/live`    | Live positions from Redis, `Cache-Control: no-store`.                                                         |

Two contracts the frontend depends on:

- **`/routes/search` separates "does a route exist" from "is a bus coming".** A route with an empty `nextDepartures` means _the last bus has gone_ — a different empty state from _no such route_, and the UI must show different copy for each.
- **`/vehicles/live` never fails because realtime is down.** Feed dead, Redis dead, region never had realtime: all return **200 with `stale: true`** and a reason. The user standing at a bus stop still gets the timetable and a banner, never an error screen. Only genuinely bad input (unknown route, missing param) errors.

Departure times are normalised at the edge: GTFS `25:10:00` becomes `{ time: "01:10", nextDay: true }`. Showing "25:10" is nonsense; showing "01:10" without the `+1` sends someone out 24 hours late.

## 4. What "production-standard UI" means here (Step 5+)

- **Design tokens, not ad-hoc styles.** Fixed spacing/type scale, semantic colours (error/warning/success), defined once in Tailwind config. No inline magic numbers.
- **Four states per data-dependent screen**, not just the happy path: loading skeleton, empty ("no buses between these stops"), error (with retry), and **stale** (RT feed down → showing last-known schedule).
- **Accessibility is not optional.** Keyboard-navigable dropdowns, ARIA labels on map controls, visible focus states, sufficient contrast. Also an app-store review factor if this goes mobile.
- **Performance budget.** Map tiles and 10s position polling are what will kill perceived speed: lazy-load the map, debounce autocomplete, virtualize long stop lists, and **update markers imperatively — never re-render the map tree on every poll.**
- **Mobile-first.** The user is standing at a bus stop holding a phone. Single-column first, expand to desktop.
- **Feedback within 100ms** on every tap. This is what separates "hackathon project" from "real app."

### Frontend foundation (Step 5, as built)

- **Tokens are enforced, not suggested.** `tailwind.config.js` **replaces** Tailwind's palette rather than extending it — leaving the defaults in place is an open invitation to a stray `bg-blue-400`. Colours resolve to CSS variables in `globals.css`, so dark mode is a variable swap, not a rewrite. Spacing is a fixed 4px scale; type is six sizes.
- **`stale` and `live` are semantic colours**, sitting alongside success/warning/danger. "The realtime feed is down, showing the timetable" is a frequent, expected state in this app, and it gets a first-class colour rather than being improvised at a call site.
- **The four states are components** (`components/ui/states.jsx`), deliberately in one file: `ListSkeleton`, `Empty`, `ErrorState`, `StaleBanner`. If you're building a screen and can only name three, you've forgotten one — and the forgotten one is always `Stale`. `/design-system` renders all four side by side.
- **The map never re-renders.** `MapView` creates MapLibre **once**; vehicle updates are applied imperatively via `marker.setLngLat()` inside an effect. A 10s poll moves existing markers instead of destroying and recreating them — that difference is the whole perceived-performance budget on a mid-range Android phone.
- **The map is lazy-loaded** (`ssr: false`). Verified: first-load JS is **~105 kB with MapLibre excluded**; it arrives only when a map is actually on screen.
- **Live polling is battery-aware.** `refetchIntervalInBackground: false` — a phone in a pocket does not poll. `placeholderData: keepPreviousData` so buses move rather than flicker.
- **Native `<select>` for the region picker.** A custom dropdown would need keyboard nav, type-ahead, focus trapping, ARIA listbox semantics and a mobile-safe popup — all of which the platform already does correctly, for free. Not where the budget goes.
- **Accessibility is a build failure, not a warning.** `eslint-plugin-jsx-a11y` runs at error level in CI, alongside `react-hooks` (which caught a real ref-cleanup bug the first time it ran).

### Screens (Step 6, as built)

One column, in the order a person actually uses it — which city → where am I → where am I going → which bus → **where is my bus**. `components/journey/JourneyPlanner.jsx` is the whole app.

- **Geolocation is a permission flow, not a value.** `useGeolocation` models idle / pending / granted / **denied** / unsupported, and every branch leaves a working app: refusing location drops you into search-by-name, never a dead end. Refusal is common, not exceptional.
- **The autocomplete is a real ARIA combobox** — arrows, Enter, Escape, `aria-activedescendant`. It's the app's primary input, and the one place a custom widget is genuinely warranted (no native element does async suggestions). Verified with keyboard-only selection in a real browser.
- **"No direct bus" says what we actually checked**, rather than implying the journey is impossible: interchanges aren't supported yet, and the copy admits it.
- Selected route → route line on the map + live buses, with the stale banner whenever realtime is unavailable.

Verified end to end in headless Chromium at a 390px viewport against the live API: region list, autocomplete, **keyboard-only stop selection**, direct-route search, stale banner, and the lazily-loaded map canvas (tiles 200, map painting). Two real bugs were caught this way and fixed — a hydration mismatch from seeding state off `navigator`, and a `setState`-in-effect cascade.

### Hardening (Step 7, as built)

The four states cover a request that _failed_. They do not cover **code that threw** — and in React 19 an
uncaught throw unmounts the entire tree, so the failure mode is a blank white screen, not a degraded one.

- **The map is the only thing here that can hard-throw, and it's the least essential thing on the page.**
  `new maplibregl.Map()` throws outright where there's no WebGL context (old Android, GPU blocklist, locked-down
  browser), and it throws from inside an effect — which React forwards straight to the nearest boundary. So
  `MapContainer` puts a boundary immediately around `MapView`: **a dead map costs you the map, not the app.**
  Exactly the rule `/vehicles/live` already follows on the server. Verified by removing WebGL from the browser in
  an e2e run: the map degrades to a placeholder while the route list, both stops and the 06:00 departure survive.
- **Boundaries are scoped tightly, and re-arm.** A boundary around the whole page turns a broken map into a broken
  app, which is the outcome it exists to prevent. And a boundary that has caught once must not stay broken
  forever — `resetKeys` re-arms it when the inputs change, so picking a different route gives the map a fresh
  chance instead of a permanent fallback.
- **Three layers, because they catch different things.** The map's boundary catches the map; `app/error.jsx`
  catches anything else in the page and offers `reset()` (a segment re-render, not a full reload on 4G);
  `app/global-error.jsx` catches the root layout itself, which `error.jsx` cannot — it renders inside it. The
  global one ships its own `<html>`/`<body>` and imports the stylesheet directly, since the layout that normally
  provides both is the thing that just died. It's deliberately the plainest screen in the app: the fewer pieces
  the error screen depends on, the smaller the chance it's broken by the bug it's reporting.
- **`error.digest` is surfaced to the user**, because in production Next strips the message from the client
  bundle and the digest is the only thing tying what the user saw to what the server logged.
- **One error-tracking seam per side** (`apps/api/src/lib/monitoring.js`, `apps/web/lib/monitoring.js`). No
  component imports a vendor SDK; with no DSN set they log and move on, so dev and CI need no account and Sentry
  is swappable in one file. **Expected failures never reach the tracker** — a bad latitude, a refused geolocation
  prompt and a dead RT feed all have states already. Paging someone for those is how alerts get muted and the one
  real outage gets missed.
- **The fifth state is in the design system, and it genuinely throws.** `/design-system` renders a live boundary
  with a "Break it" button rather than a mock of a fallback — a mocked-up error screen keeps looking correct long
  after the real one has rotted.

## 5. Deliberately cut from v1

Multi-leg/interchange routing · multi-state support · user accounts & favourites · arrival push notifications.

All reasonable v2 ideas; all expensive relative to their value _before_ real users exist. Ship direct-route search + live map + nearest stop for Delhi, put it in front of people, then build what's actually asked for rather than what was assumed.
