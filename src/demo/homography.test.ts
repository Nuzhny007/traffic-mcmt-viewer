import { describe, expect, it } from 'vitest';

import { AUBURN_DEMO, DEMO_GEO_POINTS, demoSceneFromSearch } from './demoData';
import { applyHomography, homographyFromPoints } from './homography';

describe('homographyFromPoints', () => {
  it('returns null for a degenerate point set', () => {
    const degenerate = [
      { lat: 45.0, lon: 5.0, px: 0.0, py: 0.0 },
      { lat: 45.0, lon: 5.0, px: 0.5, py: 0.5 },
      { lat: 45.0, lon: 5.0, px: 1.0, py: 1.0 },
      { lat: 45.0, lon: 5.0, px: 0.2, py: 0.8 },
    ];
    expect(homographyFromPoints(degenerate)).toBeNull();
    expect(homographyFromPoints(DEMO_GEO_POINTS.slice(0, 3))).toBeNull();
  });

  it('reproduces the control points exactly (inverse of geo_bind.ini)', () => {
    const h = homographyFromPoints(DEMO_GEO_POINTS);
    expect(h).not.toBeNull();
    for (const { lon, lat, px, py } of DEMO_GEO_POINTS) {
      const point = applyHomography(h!, lon, lat);
      // ~5e-8 in normalised coords is ~0.01 px at 1280 — far below a pixel.
      expect(point.x).toBeCloseTo(px, 6);
      expect(point.y).toBeCloseTo(py, 6);
    }
  });

  it('keeps an interpolated ground point inside the quad', () => {
    const h = homographyFromPoints(DEMO_GEO_POINTS)!;
    const a = DEMO_GEO_POINTS[0];
    const b = DEMO_GEO_POINTS[3];
    const mid = applyHomography(h, (a.lon + b.lon) / 2, (a.lat + b.lat) / 2);
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.x).toBeLessThan(1);
    expect(mid.y).toBeGreaterThan(0);
    expect(mid.y).toBeLessThan(1);
  });

  it('reproduces both Auburn camera bindings', () => {
    for (const camera of AUBURN_DEMO.cameras) {
      const h = homographyFromPoints(camera.geoPoints);
      expect(h).not.toBeNull();
      for (const { lon, lat, px, py } of camera.geoPoints) {
        const point = applyHomography(h!, lon, lat);
        // Longitude ~-85 makes the raw DLT slightly worse conditioned than the
        // Aire fit; the residual stays far below a pixel at 1920x1080.
        expect(Math.abs(point.x - px) * camera.videoSize.width).toBeLessThan(0.1);
        expect(Math.abs(point.y - py) * camera.videoSize.height).toBeLessThan(0.1);
      }
    }
  });
});

describe('demoSceneFromSearch', () => {
  it('selects the two-camera Auburn scene', () => {
    expect(demoSceneFromSearch('?demo=auburn').key).toBe('auburn');
    expect(demoSceneFromSearch('?demo=auburn').cameras).toHaveLength(2);
    expect(demoSceneFromSearch('?demo=auburn').cameras.map((c) => c.cameraId)).toEqual([1, 2]);
  });

  it('keeps the original single-camera demo for ?demo=1 and unknown values', () => {
    for (const search of ['?demo=1', '?demo=', '']) {
      const scene = demoSceneFromSearch(search);
      expect(scene.key).toBe('1');
      expect(scene.cameras).toHaveLength(1);
    }
  });
});
