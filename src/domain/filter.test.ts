import { describe, expect, it } from 'vitest';

import { filterTracks, matchesFilter, parseTrackQuery } from './filter';
import type { LiveTrack } from '../net/trackBuffer';
import { DEFAULT_VIEW } from '../store/viewStore';

function track(overrides: Partial<LiveTrack> = {}): LiveTrack {
  return {
    id: 1,
    cameraId: 1,
    className: 'car',
    position: [5.97, 45.52],
    velocity: [10, 0],
    speedKmh: 36,
    trail: [[5.97, 45.52]],
    lastSeen: 1_000,
    ...overrides,
  };
}

const ALL = { ...DEFAULT_VIEW };

describe('parseTrackQuery', () => {
  it('accepts ids with and without a hash', () => {
    expect(parseTrackQuery('1042')).toBe(1042);
    expect(parseTrackQuery('#1042')).toBe(1042);
    expect(parseTrackQuery('  42 ')).toBe(42);
  });

  it('rejects everything else', () => {
    expect(parseTrackQuery('')).toBeNull();
    expect(parseTrackQuery('#')).toBeNull();
    expect(parseTrackQuery('car')).toBeNull();
    expect(parseTrackQuery('-5')).toBeNull();
    expect(parseTrackQuery('1.5')).toBeNull();
  });
});

describe('matchesFilter', () => {
  it('keeps a track that matches the default view', () => {
    expect(matchesFilter(track(), ALL)).toBe(true);
  });

  it('drops classes that are switched off', () => {
    const filter = { ...ALL, classes: ['truck'] as const };

    expect(matchesFilter(track({ className: 'car' }), filter)).toBe(false);
    expect(matchesFilter(track({ className: 'truck' }), filter)).toBe(true);
  });

  it('treats an empty camera list as "all cameras"', () => {
    expect(matchesFilter(track({ cameraId: 7 }), { ...ALL, cameras: [] })).toBe(true);
    expect(matchesFilter(track({ cameraId: 7 }), { ...ALL, cameras: [1] })).toBe(false);
  });

  it('applies the minimum speed', () => {
    const filter = { ...ALL, minSpeedKmh: 30 };

    expect(matchesFilter(track({ speedKmh: 29.9 }), filter)).toBe(false);
    expect(matchesFilter(track({ speedKmh: 30 }), filter)).toBe(true);
  });

  it('narrows to a single id when the search box holds one', () => {
    const filter = { ...ALL, query: '#2' };

    expect(matchesFilter(track({ id: 1 }), filter)).toBe(false);
    expect(matchesFilter(track({ id: 2 }), filter)).toBe(true);
  });

  it('ignores a non-numeric search', () => {
    expect(matchesFilter(track({ id: 1 }), { ...ALL, query: 'car' })).toBe(true);
  });
});

describe('filterTracks', () => {
  it('returns the input array untouched for the default view', () => {
    const tracks = [track(), track({ id: 2, className: 'bus' })];

    expect(filterTracks(tracks, ALL)).toBe(tracks);
  });

  it('filters by class and camera together', () => {
    const tracks = [
      track({ id: 1, className: 'car', cameraId: 1 }),
      track({ id: 2, className: 'car', cameraId: 2 }),
      track({ id: 3, className: 'bus', cameraId: 1 }),
    ];

    const visible = filterTracks(tracks, { ...ALL, classes: ['car'], cameras: [2] });

    expect(visible.map((item) => item.id)).toEqual([2]);
  });

  it('can return an empty list', () => {
    const visible = filterTracks([track({ className: 'car' })], {
      ...ALL,
      classes: ['truck'],
    });

    expect(visible).toEqual([]);
  });
});
