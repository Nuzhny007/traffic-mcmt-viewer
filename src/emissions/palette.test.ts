import { describe, expect, it } from 'vitest';

import {
  emissionColor,
  normalizeLog,
  POLLUTANT_INFO,
  rampCss,
  rasterizeEmission,
  sampleRamp,
} from './palette';
import type { EmissionGridMessage } from '../types/emissions';

const STOPS = POLLUTANT_INFO.NOx.stops;

describe('emission palette', () => {
  it('normalises logarithmically and clamps to 0..1', () => {
    expect(normalizeLog(0, 100)).toBe(0);
    expect(normalizeLog(-1, 100)).toBe(0);
    expect(normalizeLog(100, 100)).toBeCloseTo(1, 6);
    expect(normalizeLog(10, 100)).toBeGreaterThan(0.5);
    expect(normalizeLog(10, 100)).toBeLessThan(1);
    expect(normalizeLog(200, 100)).toBe(1);
  });

  it('samples ramp ends and the midpoint', () => {
    const ramp = [
      { t: 0, rgb: [0, 0, 0] as const },
      { t: 1, rgb: [255, 255, 255] as const },
    ];
    expect(sampleRamp(ramp, 0)).toEqual([0, 0, 0]);
    expect(sampleRamp(ramp, 1)).toEqual([255, 255, 255]);
    expect(sampleRamp(ramp, 0.5)).toEqual([128, 128, 128]);
  });

  it('makes empty cells transparent', () => {
    expect(emissionColor(0, 100, STOPS)).toEqual([0, 0, 0, 0]);
    const [r, g, b, a] = emissionColor(100, 100, STOPS);
    expect(a).toBeGreaterThan(200);
    expect([r, g, b].some((channel) => channel > 0)).toBe(true);
  });

  it('flips raster rows so the image starts at the north edge', () => {
    const frame: EmissionGridMessage = {
      type: 'emission_grid',
      timestamp: 0,
      unit: 'ug/m3',
      bounds: { west: 0, south: 0, east: 1, north: 2 },
      cols: 1,
      rows: 2,
      fields: {
        NOx: {
          // South row empty, north row at the maximum.
          data: new Float32Array([0, 1]),
          max: 1,
          mean: 0.5,
          p95: 1,
        },
      },
    };

    const image = rasterizeEmission(frame, 'NOx');
    expect(image).not.toBeNull();
    expect(image?.width).toBe(1);
    expect(image?.height).toBe(2);
    // First image row = north = data row 1.
    expect(image?.pixels[3]).toBeGreaterThan(0);
    // Second image row = south = data row 0.
    expect(image?.pixels[7]).toBe(0);
  });

  it('returns null when the pollutant is missing', () => {
    const frame: EmissionGridMessage = {
      type: 'emission_grid',
      timestamp: 0,
      unit: 'ug/m3',
      bounds: { west: 0, south: 0, east: 1, north: 1 },
      cols: 1,
      rows: 1,
      fields: {},
    };
    expect(rasterizeEmission(frame, 'NOx')).toBeNull();
  });

  it('renders a CSS gradient for the legend', () => {
    const css = rampCss(STOPS);
    expect(css.startsWith('linear-gradient(to right,')).toBe(true);
    expect(css).toContain('100%');
  });
});
