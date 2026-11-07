import { PathLayer } from '@deck.gl/layers';

import { classColor } from '../domain/classes';
import type { LiveTrack } from '../net/trackBuffer';

export function createTrackPathLayer(tracks: LiveTrack[]) {
  return new PathLayer<LiveTrack>({
    id: 'track-trails',
    data: tracks,
    getPath: (track) => track.trail,
    getColor: (track) => {
      const [r, g, b] = classColor(track.className);
      return [r, g, b, 170];
    },
    getWidth: 2.5,
    widthUnits: 'pixels',
    widthMinPixels: 1.5,
    capRounded: true,
    jointRounded: true,
    pickable: false,
  });
}
