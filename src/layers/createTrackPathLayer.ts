import { PathLayer } from '@deck.gl/layers';

import { classColor } from '../domain/classes';
import { deadReckon, fadeAlpha, trailWithHead } from '../domain/motion';
import type { LiveTrack } from '../net/trackBuffer';

export function createTrackPathLayer(
  tracks: LiveTrack[],
  /** Monotonic render time, or null to draw the raw last position. */
  atMs: number | null,
  ttlMs: number,
) {
  return new PathLayer<LiveTrack>({
    id: 'track-trails',
    data: tracks,
    getPath: (track) => trailWithHead(track.trail, deadReckon(track, atMs)),
    getColor: (track) => {
      const [r, g, b] = classColor(track.className);
      const alpha = atMs === null ? 170 : 170 * fadeAlpha(atMs - track.lastSeen, ttlMs);
      return [r, g, b, Math.round(alpha)];
    },
    getWidth: 2.5,
    widthUnits: 'pixels',
    widthMinPixels: 1.5,
    capRounded: true,
    jointRounded: true,
    pickable: false,
    updateTriggers: {
      getPath: [atMs],
      getColor: [atMs, ttlMs],
    },
  });
}
