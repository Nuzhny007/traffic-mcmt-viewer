import { describe, expect, it } from 'vitest';

import type { TrackUpdate } from '../types/tracking';
import { TrackBuffer } from './trackBuffer';

function update(
  id: number,
  position: [number, number],
  overrides: Partial<TrackUpdate> = {},
): TrackUpdate {
  return {
    global_id: id,
    camera_id: 1,
    class: 'car',
    position,
    ...overrides,
  };
}

describe('TrackBuffer', () => {
  it('applies delta updates and bumps the version', () => {
    const buffer = new TrackBuffer();
    const before = buffer.version;

    buffer.apply([update(1, [5.97, 45.52])], 'delta', 1000);

    expect(buffer.size).toBe(1);
    expect(buffer.version).toBeGreaterThan(before);
    expect(buffer.get(1)?.position).toEqual([5.97, 45.52]);
  });

  it('accumulates a trail and caps it', () => {
    const buffer = new TrackBuffer();
    buffer.apply([update(1, [5.0, 45.0])], 'delta', 1000);

    for (let i = 1; i <= 50; i += 1) {
      buffer.apply([update(1, [5.0 + i * 0.0001, 45.0])], 'delta', 1000 + i);
    }

    const track = buffer.get(1);
    expect(track?.trail.length).toBe(40);
    expect(track?.trail.at(-1)?.[0]).toBeCloseTo(5.005, 6);
    expect(track?.trail.at(-1)?.[1]).toBe(45.0);
  });

  it('uses the trail from the server when provided', () => {
    const buffer = new TrackBuffer();
    buffer.apply(
      [
        update(1, [5.2, 45.2], {
          trail: [
            [5.0, 45.0],
            [5.1, 45.1],
          ],
        }),
      ],
      'delta',
      1000,
    );

    expect(buffer.get(1)?.trail).toEqual([
      [5.0, 45.0],
      [5.1, 45.1],
    ]);
  });

  it('clears the buffer on a snapshot', () => {
    const buffer = new TrackBuffer();
    buffer.apply([update(1, [5.0, 45.0])], 'delta', 1000);
    buffer.apply([update(2, [5.1, 45.1])], 'snapshot', 2000);

    expect(buffer.size).toBe(1);
    expect(buffer.get(1)).toBeUndefined();
    expect(buffer.get(2)).toBeDefined();
  });

  it('stores speed_kmh and falls back to velocity', () => {
    const buffer = new TrackBuffer();
    buffer.apply([update(1, [5.0, 45.0], { speed_kmh: 36 })], 'delta', 1000);
    expect(buffer.get(1)?.speedKmh).toBe(36);

    buffer.apply([update(2, [5.0, 45.0], { velocity: [10, 0] })], 'delta', 1001);
    expect(buffer.get(2)?.speedKmh).toBeCloseTo(36, 5);
  });

  it('removes tracks reported by the backend', () => {
    const buffer = new TrackBuffer();
    buffer.apply(
      [update(1, [5.0, 45.0]), update(2, [5.1, 45.1])],
      'delta',
      1000,
    );

    expect(buffer.remove([1, 99])).toBe(1);
    expect(buffer.get(1)).toBeUndefined();
    expect(buffer.size).toBe(1);
  });

  it('re-keys a track on id merge', () => {
    const buffer = new TrackBuffer();
    buffer.apply([update(10, [5.0, 45.0])], 'delta', 1000);

    buffer.mergeIds(10, 500);

    expect(buffer.get(10)).toBeUndefined();
    expect(buffer.get(500)?.id).toBe(500);
    expect(buffer.get(500)?.position).toEqual([5.0, 45.0]);
  });

  it('prunes stale tracks', () => {
    const buffer = new TrackBuffer();
    buffer.apply(
      [update(1, [5.0, 45.0]), update(2, [5.1, 45.1])],
      'delta',
      1000,
    );
    buffer.apply([update(2, [5.1, 45.1])], 'delta', 5000);

    expect(buffer.prune(3000, 6000)).toBe(1);
    expect(buffer.size).toBe(1);
    expect(buffer.get(2)).toBeDefined();
  });

  it('returns a cached list that is invalidated on change', () => {
    const buffer = new TrackBuffer();
    buffer.apply([update(1, [5.0, 45.0])], 'delta', 1000);
    const first = buffer.list();

    expect(buffer.list()).toBe(first);

    buffer.apply([update(2, [5.1, 45.1])], 'delta', 1001);
    expect(buffer.list()).not.toBe(first);
    expect(buffer.list()).toHaveLength(2);
  });
});
