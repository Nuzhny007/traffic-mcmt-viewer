import { ScatterplotLayer } from '@deck.gl/layers';

import { classColor } from '../domain/classes';
import { deadReckon, fadeAlpha } from '../domain/motion';
import type { LiveTrack } from '../net/trackBuffer';

export function createTrackPointLayer(
  tracks: LiveTrack[],
  selectedId: number | null,
  /** Monotonic render time, or null to draw the raw last position. */
  atMs: number | null,
  ttlMs: number,
) {
  return new ScatterplotLayer<LiveTrack>({
    id: 'track-points',
    data: tracks,
    // Dead reckoning moves the marker between the 10 Hz updates; the trail head
    // uses the same function, so path and marker never disagree.
    getPosition: (track) => deadReckon(track, atMs),
    getRadius: (track) => (track.id === selectedId ? 10 : 5.5),
    radiusUnits: 'pixels',
    radiusMinPixels: 3,
    getFillColor: (track) => {
      const [r, g, b, a] = classColor(track.className);
      const alpha = atMs === null ? a : a * fadeAlpha(atMs - track.lastSeen, ttlMs);
      return [r, g, b, Math.round(alpha)];
    },
    stroked: true,
    getLineColor: (track) =>
      track.id === selectedId ? [255, 255, 255, 255] : [8, 12, 20, 230],
    getLineWidth: (track) => (track.id === selectedId ? 2 : 1),
    lineWidthUnits: 'pixels',
    pickable: true,
    updateTriggers: {
      getPosition: [atMs],
      getFillColor: [atMs, ttlMs],
      getRadius: [selectedId],
      getLineColor: [selectedId],
      getLineWidth: [selectedId],
    },
  });
}
