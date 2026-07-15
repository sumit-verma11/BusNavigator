-- Up Migration
-- More states/cities so the region picker is a real state -> city cascade.
--
-- IMPORTANT: a row here means "we support this city", NOT "we have its data".
-- Timetable data only exists once a GTFS feed has been ingested for that region
-- (see feed_imports). The API exposes `has_data` per region so the UI can say
-- "coming soon" instead of showing an empty app and letting the user assume the
-- city has no buses.

INSERT INTO supported_regions (slug, country_code, state, city, timezone, bbox, is_active, has_realtime)
VALUES
  ('gurugram',  'IN', 'Haryana',     'Gurugram',  'Asia/Kolkata', ST_MakeEnvelope(76.8500, 28.3500, 77.1500, 28.5500, 4326), TRUE, FALSE),
  ('faridabad', 'IN', 'Haryana',     'Faridabad', 'Asia/Kolkata', ST_MakeEnvelope(77.2400, 28.3200, 77.4200, 28.5200, 4326), TRUE, FALSE),
  ('hyderabad', 'IN', 'Telangana',   'Hyderabad', 'Asia/Kolkata', ST_MakeEnvelope(78.2400, 17.2000, 78.6500, 17.6000, 4326), TRUE, FALSE),
  ('warangal',  'IN', 'Telangana',   'Warangal',  'Asia/Kolkata', ST_MakeEnvelope(79.5000, 17.9200, 79.6600, 18.0500, 4326), TRUE, FALSE),
  ('bengaluru', 'IN', 'Karnataka',   'Bengaluru', 'Asia/Kolkata', ST_MakeEnvelope(77.4500, 12.8300, 77.7800, 13.1400, 4326), TRUE, FALSE),
  ('mysuru',    'IN', 'Karnataka',   'Mysuru',    'Asia/Kolkata', ST_MakeEnvelope(76.5800, 12.2400, 76.7200, 12.3800, 4326), TRUE, FALSE),
  ('mumbai',    'IN', 'Maharashtra', 'Mumbai',    'Asia/Kolkata', ST_MakeEnvelope(72.7700, 18.8900, 72.9900, 19.2800, 4326), TRUE, FALSE),
  ('pune',      'IN', 'Maharashtra', 'Pune',      'Asia/Kolkata', ST_MakeEnvelope(73.7200, 18.4200, 73.9900, 18.6400, 4326), TRUE, FALSE),
  ('chennai',   'IN', 'Tamil Nadu',  'Chennai',   'Asia/Kolkata', ST_MakeEnvelope(80.1500, 12.9000, 80.3200, 13.2000, 4326), TRUE, FALSE)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO feed_health (region_id)
SELECT id FROM supported_regions
 WHERE slug IN ('gurugram','faridabad','hyderabad','warangal','bengaluru','mysuru','mumbai','pune','chennai')
ON CONFLICT (region_id) DO NOTHING;

-- Down Migration

DELETE FROM supported_regions
 WHERE slug IN ('gurugram','faridabad','hyderabad','warangal','bengaluru','mysuru','mumbai','pune','chennai');
