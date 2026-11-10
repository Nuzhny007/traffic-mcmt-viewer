import { describe, expect, it } from 'vitest';

import {
  deadReckon,
  fadeAlpha,
  MAX_EXTRAPOLATION_MS,
  trailWithHead,
  type MotionTrack,
} from './motion';

const LAT = 45.5268;
const LON = 5.9745;
/** Metres per degree of longitude at `LAT`, matching the motion model. */
const M_PER_DEG_LON = 111_320 * Math.cos((LAT * Math.PI) / 180);

function track(overrides: Partial<MotionTrack> = {}): MotionTrack {
  return {
    position: [LON, LAT],
    velocity: [10, 0],
    lastSeen: 1_000,
    ...overrides,
  };
}

describe('deadReckon', () => {
  it('returns the raw position when animation is disabled', () => {
    expect(deadReckon(track(), null)).toEqual([LON, LAT]);
  });

  it('moves along the velocity vector', () => {
    const moved = deadReckon(track(), 1_100);

    // 10 m/s for 100 ms -> 1 m east.
    expect(moved[0] - LON).toBeCloseTo(1 / M_PER_DEG_LON, 9);
    expect(moved[1] - LAT).toBeCloseTo(0, 9);
  });

  it('moves north for a positive vy', () => {
    const moved = deadReckon(track({ velocity: [0, 10] }), 1_050);

    expect(moved[0]).toBeCloseTo(LON, 9);
    expect(moved[1] - LAT).toBeCloseTo(0.5 / 110_540, 9);
  });

  it('caps extrapolation at the maximum window', () => {
    const capped = deadReckon(track(), 1_000 + MAX_EXTRAPOLATION_MS);
    const far = deadReckon(track(), 1_000 + 10_000);

    expect(far).toEqual(capped);
  });

  it('never moves backwards in time', () => {
    expect(deadReckon(track({ lastSeen: 5_000 }), 4_000)).toEqual([LON, LAT]);
  });

  it('ignores a velocity below the noise floor', () => {
    expect(deadReckon(track({ velocity: [0.01, 0.01] }), 1_100)).toEqual([LON, LAT]);
  });

  it('keeps the last fix for non-finite velocities', () => {
    expect(deadReckon(track({ velocity: [Number.NaN, 0] }), 1_100)).toEqual([LON, LAT]);
  });
});

describe('trailWithHead', () => {
  it('appends the extrapolated head', () => {
    const trail: [number, number][] = [
      [LON, LAT],
      [LON + 1e-4, LAT],
    ];

    const path = trailWithHead(trail, [LON + 2e-4, LAT]);

    expect(path).toHaveLength(3);
    expect(path.at(-1)).toEqual([LON + 2e-4, LAT]);
    expect(trail).toHaveLength(2);
  });

  it('does not duplicate the head when it coincides with the last point', () => {
    const trail: [number, number][] = [[LON, LAT]];

    expect(trailWithHead(trail, [LON, LAT])).toBe(trail);
  });
});

describe('fadeAlpha', () => {
  it('keeps fresh and invalid tracks fully opaque', () => {
    expect(fadeAlpha(0, 8_000)).toBe(1);
    expect(fadeAlpha(1_000, 8_000)).toBe(1);
    expect(fadeAlpha(500, 0)).toBe(1);
  });

  it('fades linearly towards zero at the TTL', () => {
    expect(fadeAlpha(5_000, 8_000)).toBeCloseTo(0.5, 5);
    expect(fadeAlpha(8_000, 8_000)).toBe(0);
    expect(fadeAlpha(60_000, 8_000)).toBe(0);
  });

  it('is monotonic', () => {
    const samples = [0, 1_000, 2_000, 4_000, 6_000, 8_000].map((age) => fadeAlpha(age, 8_000));

    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]!).toBeLessThanOrEqual(samples[i - 1]!);
    }
  });
});
