import { describe, expect, it } from 'vitest';

import { DEMO_GEO_POINTS } from './demoData';
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
});
