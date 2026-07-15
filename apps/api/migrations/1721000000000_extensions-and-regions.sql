-- Up Migration

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fuzzy stop/route name search (autocomplete)

-- Every ingested artefact hangs off a region. This is what makes "Delhi only for
-- v1, more cities later" a data question instead of a rewrite.
CREATE TABLE supported_regions (
  id                  SERIAL PRIMARY KEY,
  slug                TEXT NOT NULL UNIQUE,          -- 'delhi'
  country_code        CHAR(2) NOT NULL DEFAULT 'IN',
  state               TEXT NOT NULL,                 -- 'Delhi'
  city                TEXT NOT NULL,                 -- 'New Delhi'
  timezone            TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  bbox                geometry(Polygon, 4326),       -- reject lat/lng outside the region
  is_active           BOOLEAN NOT NULL DEFAULT TRUE, -- shown in the region picker
  has_realtime        BOOLEAN NOT NULL DEFAULT FALSE,-- flipped OFF automatically by feed health
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX supported_regions_bbox_idx ON supported_regions USING GIST (bbox);
CREATE INDEX supported_regions_active_idx ON supported_regions (is_active) WHERE is_active;

-- Static GTFS import audit. `content_hash` makes re-ingestion idempotent:
-- same hash => skip, don't re-upsert 40k stop_times for nothing.
CREATE TABLE feed_imports (
  id             SERIAL PRIMARY KEY,
  region_id      INTEGER NOT NULL REFERENCES supported_regions (id) ON DELETE CASCADE,
  feed_url       TEXT NOT NULL,
  content_hash   TEXT,
  status         TEXT NOT NULL DEFAULT 'running'
                 CHECK (status IN ('running', 'succeeded', 'failed', 'skipped')),
  error          TEXT,
  stats          JSONB NOT NULL DEFAULT '{}'::jsonb, -- rows upserted per table
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ
);

CREATE INDEX feed_imports_region_started_idx ON feed_imports (region_id, started_at DESC);

-- Realtime feed health. Consecutive failures past a threshold flip
-- supported_regions.has_realtime to FALSE so the UI shows a stale-data banner
-- instead of silently lying about bus positions.
CREATE TABLE feed_health (
  region_id             INTEGER PRIMARY KEY REFERENCES supported_regions (id) ON DELETE CASCADE,
  last_success_at       TIMESTAMPTZ,
  last_failure_at       TIMESTAMPTZ,
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  last_error            TEXT,
  vehicle_count         INTEGER NOT NULL DEFAULT 0, -- from the most recent successful poll
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Down Migration

DROP TABLE IF EXISTS feed_health;
DROP TABLE IF EXISTS feed_imports;
DROP TABLE IF EXISTS supported_regions;
