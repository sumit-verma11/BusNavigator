'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const DELHI = { center: [77.209, 28.6139], zoom: 11 };

/**
 * PERFORMANCE CONTRACT — the reason this component looks the way it does.
 *
 * Vehicle positions are polled every ~10s. If each poll re-rendered React markers,
 * every bus on screen would be destroyed and recreated, the map would jank, and the
 * app would feel broken on exactly the mid-range Android phone most users have.
 *
 * So: the map is created ONCE and never re-created. Vehicle updates are applied
 * IMPERATIVELY through refs (`marker.setLngLat(...)`) inside an effect. React owns
 * the container element; MapLibre owns everything inside it. `vehicles` changing
 * moves existing markers — it does not re-render the map.
 */
export default function MapView({ center, shape, vehicles = [], onLoad }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map()); // vehicleId -> maplibregl.Marker

  // Explicit readiness, tracked from the map's own 'load' event.
  //
  // Do NOT gate on map.isStyleLoaded(): it reports false while tiles are still
  // fetching *even after* 'load' has fired. Code that checks it and otherwise falls
  // back to map.once('load', …) registers a listener for an event that has already
  // happened — so the route line silently never gets added. That bug shipped once.
  const [ready, setReady] = useState(false);

  // --- create the map exactly once -----------------------------------------
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      // Free raster tiles: no API key needed to get moving. Swap for a vector
      // style (and an attribution-compliant provider) before going wide.
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: center ?? DELHI.center,
      zoom: center ? 14 : DELHI.zoom,
      attributionControl: true,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), 'top-right');
    map.on('load', () => {
      setReady(true); // re-runs the shape/vehicle effects with a map that can accept layers
      onLoad?.(map);
    });

    mapRef.current = map;
    const markers = markersRef.current; // captured for cleanup; the ref may be reassigned by then

    return () => {
      map.remove();
      mapRef.current = null;
      markers.clear();
    };
    // Intentionally empty: the map must survive every prop change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- route line: a source swap, not a map rebuild -------------------------
  useEffect(() => {
    const map = mapRef.current;
    // `ready` is the whole point: the effect simply re-runs once the map has loaded,
    // so there is no "has it loaded yet?" guess and no listener to miss.
    if (!map || !ready || !shape) return;

    const data = { type: 'Feature', geometry: shape, properties: {} };
    const existing = map.getSource('route');

    if (existing) {
      existing.setData(data);
    } else {
      map.addSource('route', { type: 'geojson', data });
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        paint: { 'line-color': '#1668d6', 'line-width': 5, 'line-opacity': 0.9 },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });
    }

    const coords = shape.coordinates ?? [];
    if (coords.length > 1) {
      const bounds = coords.reduce(
        (b, c) => b.extend(c),
        new maplibregl.LngLatBounds(coords[0], coords[0]),
      );
      map.fitBounds(bounds, { padding: 40, duration: 400 });
    }
  }, [shape, ready]);

  // --- vehicles: MOVE markers, never recreate them --------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const seen = new Set();

    for (const v of vehicles) {
      seen.add(v.id);
      const existing = markersRef.current.get(v.id);

      if (existing) {
        // The hot path: a bus that moved 30 metres just moves 30 metres.
        existing.setLngLat([v.lng, v.lat]);
        if (v.bearing != null) existing.setRotation(v.bearing);
      } else {
        const el = document.createElement('div');
        el.className = 'busnav-vehicle';
        el.setAttribute('role', 'img');
        el.setAttribute('aria-label', `Bus ${v.label ?? v.id}`);

        const marker = new maplibregl.Marker({ element: el, rotationAlignment: 'map' })
          .setLngLat([v.lng, v.lat])
          .addTo(map);

        if (v.bearing != null) marker.setRotation(v.bearing);
        markersRef.current.set(v.id, marker);
      }
    }

    // A bus that finished its trip must leave the map.
    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }
  }, [vehicles]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      // The map is a visual aid, not the only way to use this app: every stop and
      // route on it is also reachable as text in the list beside it.
      aria-hidden="true"
    />
  );
}
