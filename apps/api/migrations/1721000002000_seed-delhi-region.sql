-- Up Migration
-- Reference data, not user data: the v1 region. Idempotent so re-running is safe.

INSERT INTO supported_regions (slug, country_code, state, city, timezone, bbox, is_active, has_realtime)
VALUES (
  'delhi',
  'IN',
  'Delhi',
  'New Delhi',
  'Asia/Kolkata',
  ST_MakeEnvelope(76.8388, 28.4041, 77.3465, 28.8835, 4326), -- NCT of Delhi bounding box
  TRUE,
  FALSE -- flipped on by the RT poller once a feed actually succeeds
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO feed_health (region_id)
SELECT id FROM supported_regions WHERE slug = 'delhi'
ON CONFLICT (region_id) DO NOTHING;

-- Down Migration

DELETE FROM supported_regions WHERE slug = 'delhi';
