import type { GeoPointPx } from './homography';

/**
 * Static demo configuration for the single-camera Aire scenario.
 *
 * Values mirror `data/aire/geo_bind.ini` from the TrafficMCMT repository and
 * the export command that produced `build/datasets/aire/cam-01-demo.jsonl`
 * (`--start-epoch-ms 1620599040000`, `--start-frame 0`), so video position 0
 * corresponds to protocol timestamp `epochMs`.
 */
export const DEMO_EPOCH_MS = 1_620_599_040_000;

export const DEMO_VIDEO_URL = '/demo/Relaxing_highway_traffic.mp4';

export const DEMO_VIDEO_SIZE = {
  width: 1280,
  height: 720,
} as const;

/** Control points from `data/aire/geo_bind.ini` ([lat, lon] <-> [px, py]). */
export const DEMO_GEO_POINTS: readonly GeoPointPx[] = [
  { lat: 45.526646, lon: 5.974535, px: 0.328125, py: 0.483333333333333 },
  { lat: 45.527566, lon: 5.973849, px: 0.39765625, py: 0.393055555555556 },
  { lat: 45.527904, lon: 5.974135, px: 0.57109375, py: 0.390277777777778 },
  { lat: 45.526867, lon: 5.974826, px: 0.65625, py: 0.476388888888889 },
];

/** Per-object colour palette: vivid hues spread by the golden angle. */
export function trackColor(id: number): string {
  const hue = (id * 137.508) % 360;
  return `hsl(${hue.toFixed(1)}, 92%, 62%)`;
}
