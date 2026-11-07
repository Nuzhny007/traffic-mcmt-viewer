import { describe, expect, it } from 'vitest';

import { classColor } from '../domain/classes';
import { DEMO_TRACKS, DEMO_ZONES } from './staticData';

describe('demo static data', () => {
  it('has unique track ids', () => {
    const ids = new Set(DEMO_TRACKS.map((track) => track.globalId));
    expect(ids.size).toBe(DEMO_TRACKS.length);
  });

  it('keeps every track position inside its trail', () => {
    for (const track of DEMO_TRACKS) {
      expect(track.trail.length).toBeGreaterThan(1);
      expect(track.trail.at(-1)).toEqual(track.position);
    }
  });

  it('defines camera zones with at least three vertices', () => {
    expect(DEMO_ZONES.length).toBeGreaterThan(0);
    for (const zone of DEMO_ZONES) {
      expect(zone.polygon.length).toBeGreaterThanOrEqual(3);
      expect(zone.color).toHaveLength(4);
    }
  });

  it('falls back to the unknown colour for unknown classes', () => {
    expect(classColor('spaceship')).toEqual(classColor('unknown'));
  });
});
