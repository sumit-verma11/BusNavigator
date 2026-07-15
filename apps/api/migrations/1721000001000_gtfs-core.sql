-- Up Migration
-- GTFS static core. Surrogate integer PKs + (region_id, gtfs_*_id) unique keys:
-- GTFS ids are only unique within a feed, and joins on ints beat joins on text.

CREATE TABLE agencies (
  id             SERIAL PRIMARY KEY,
  region_id      INTEGER NOT NULL REFERENCES supported_regions (id) ON DELETE CASCADE,
  gtfs_agency_id TEXT NOT NULL,
  name           TEXT NOT NULL,
  url            TEXT,
  timezone       TEXT,
  UNIQUE (region_id, gtfs_agency_id)
);

CREATE TABLE stops (
  id            SERIAL PRIMARY KEY,
  region_id     INTEGER NOT NULL REFERENCES supported_regions (id) ON DELETE CASCADE,
  gtfs_stop_id  TEXT NOT NULL,
  code          TEXT,
  name          TEXT NOT NULL,
  location      geography(Point, 4326) NOT NULL, -- geography => ST_DWithin in METRES
  location_type SMALLINT NOT NULL DEFAULT 0,     -- 0 stop, 1 station
  parent_id     INTEGER REFERENCES stops (id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (region_id, gtfs_stop_id)
);

-- The index behind /stops/nearby. Without it, "buses near me" table-scans.
CREATE INDEX stops_location_idx ON stops USING GIST (location);
CREATE INDEX stops_name_trgm_idx ON stops USING GIN (name gin_trgm_ops); -- autocomplete
CREATE INDEX stops_region_idx ON stops (region_id);

CREATE TABLE routes (
  id             SERIAL PRIMARY KEY,
  region_id      INTEGER NOT NULL REFERENCES supported_regions (id) ON DELETE CASCADE,
  gtfs_route_id  TEXT NOT NULL,
  agency_id      INTEGER REFERENCES agencies (id) ON DELETE SET NULL,
  short_name     TEXT,          -- '764'
  long_name      TEXT,          -- 'Nehru Place -> Anand Vihar ISBT'
  route_type     SMALLINT NOT NULL DEFAULT 3, -- 3 = bus
  color          CHAR(6),
  text_color     CHAR(6),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (region_id, gtfs_route_id)
);

CREATE INDEX routes_region_idx ON routes (region_id);
CREATE INDEX routes_short_name_trgm_idx ON routes USING GIN (short_name gin_trgm_ops);

CREATE TABLE shapes (
  id             SERIAL PRIMARY KEY,
  region_id      INTEGER NOT NULL REFERENCES supported_regions (id) ON DELETE CASCADE,
  gtfs_shape_id  TEXT NOT NULL,
  geom           geometry(LineString, 4326) NOT NULL, -- one row per shape, not per point
  UNIQUE (region_id, gtfs_shape_id)
);

CREATE INDEX shapes_geom_idx ON shapes USING GIST (geom);

CREATE TABLE calendar (
  id            SERIAL PRIMARY KEY,
  region_id     INTEGER NOT NULL REFERENCES supported_regions (id) ON DELETE CASCADE,
  service_id    TEXT NOT NULL,
  monday        BOOLEAN NOT NULL DEFAULT FALSE,
  tuesday       BOOLEAN NOT NULL DEFAULT FALSE,
  wednesday     BOOLEAN NOT NULL DEFAULT FALSE,
  thursday      BOOLEAN NOT NULL DEFAULT FALSE,
  friday        BOOLEAN NOT NULL DEFAULT FALSE,
  saturday      BOOLEAN NOT NULL DEFAULT FALSE,
  sunday        BOOLEAN NOT NULL DEFAULT FALSE,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  UNIQUE (region_id, service_id)
);

CREATE TABLE calendar_dates (
  id                SERIAL PRIMARY KEY,
  region_id         INTEGER NOT NULL REFERENCES supported_regions (id) ON DELETE CASCADE,
  service_id        TEXT NOT NULL,
  date              DATE NOT NULL,
  exception_type    SMALLINT NOT NULL CHECK (exception_type IN (1, 2)), -- 1 added, 2 removed
  UNIQUE (region_id, service_id, date)
);

CREATE TABLE trips (
  id            SERIAL PRIMARY KEY,
  region_id     INTEGER NOT NULL REFERENCES supported_regions (id) ON DELETE CASCADE,
  gtfs_trip_id  TEXT NOT NULL,
  route_id      INTEGER NOT NULL REFERENCES routes (id) ON DELETE CASCADE,
  shape_id      INTEGER REFERENCES shapes (id) ON DELETE SET NULL,
  service_id    TEXT NOT NULL,
  headsign      TEXT,
  direction_id  SMALLINT CHECK (direction_id IN (0, 1)),
  UNIQUE (region_id, gtfs_trip_id)
);

CREATE INDEX trips_route_idx ON trips (route_id);
CREATE INDEX trips_service_idx ON trips (region_id, service_id);

-- The big one (millions of rows for a city feed). BIGSERIAL, and no per-row
-- surrogate lookups in the hot path: (trip_id, stop_sequence) is the natural key.
CREATE TABLE stop_times (
  id             BIGSERIAL PRIMARY KEY,
  trip_id        INTEGER NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  stop_id        INTEGER NOT NULL REFERENCES stops (id) ON DELETE CASCADE,
  stop_sequence  INTEGER NOT NULL,
  -- INTERVAL, not TIME: GTFS legally encodes past-midnight service as '25:10:00'.
  arrival_time   INTERVAL,
  departure_time INTERVAL,
  UNIQUE (trip_id, stop_sequence)
);

CREATE INDEX stop_times_stop_idx ON stop_times (stop_id);
CREATE INDEX stop_times_trip_seq_idx ON stop_times (trip_id, stop_sequence);
-- Serves the direct-route query: "trips passing A then B" filters by departure window.
CREATE INDEX stop_times_stop_departure_idx ON stop_times (stop_id, departure_time);

-- Down Migration

DROP TABLE IF EXISTS stop_times;
DROP TABLE IF EXISTS trips;
DROP TABLE IF EXISTS calendar_dates;
DROP TABLE IF EXISTS calendar;
DROP TABLE IF EXISTS shapes;
DROP TABLE IF EXISTS routes;
DROP TABLE IF EXISTS stops;
DROP TABLE IF EXISTS agencies;
