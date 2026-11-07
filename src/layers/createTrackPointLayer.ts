import { ScatterplotLayer } from '@deck.gl/layers';

import { classColor } from '../domain/classes';
import type { LiveTrack } from '../net/trackBuffer';

export function createTrackPointLayer(
  tracks: LiveTrack[],
  selectedId: number | null,
) {
  return new ScatterplotLayer<LiveTrack>({
    id: 'track-points',
    data: tracks,
    getPosition: (track) => track.position,
    getRadius: (track) => (track.id === selectedId ? 10 : 5.5),
    radiusUnits: 'pixels',
    radiusMinPixels: 3,
    getFillColor: (track) => classColor(track.className),
    stroked: true,
    getLineColor: (track) =>
      track.id === selectedId ? [255, 255, 255, 255] : [8, 12, 20, 230],
    getLineWidth: (track) => (track.id === selectedId ? 2 : 1),
    lineWidthUnits: 'pixels',
    pickable: true,
    // The buffer updates at 10 Hz; nothing needs to be recalculated per frame.
    updateTriggers: {
      getRadius: [selectedId],
      getLineColor: [selectedId],
      getLineWidth: [selectedId],
    },
  });
}
