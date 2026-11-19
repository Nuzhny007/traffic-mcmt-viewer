import type { GeoPointPx } from './homography';

/** One camera rendered in the demo layout. */
export interface DemoCamera {
  /** `cameras[].camera_id` from the gateway feed config; filters WS tracks. */
  cameraId: number;
  /** Human-readable camera name shown in the caption. */
  label: string;
  /** Text under the video. */
  caption: string;
  videoUrl: string;
  videoSize: { width: number; height: number };
  /** Control points from this camera's `geo_bind.ini` ([lat, lon] <-> [px, py]). */
  geoPoints: readonly GeoPointPx[];
}

/** A demo scenario selected with `?demo=<key>`. */
export interface DemoScene {
  /** Value of the `?demo=` query parameter. */
  key: string;
  /**
   * Protocol timestamp of video position 0: the exporter's
   * `--start-epoch-ms` plus `--start-frame / fps * 1000`. The video player
   * seeks to `(track timestamp - epochMs) / 1000`.
   */
  epochMs: number;
  cameras: readonly DemoCamera[];
}

/**
 * Single-camera Aire scene. Values mirror `data/aire/geo_bind.ini` and the
 * export command that produced `build/datasets/aire/cam-01-demo.jsonl`
 * (`--start-epoch-ms 1620599040000`, `--start-frame 0`).
 */
export const AIRE_DEMO: DemoScene = {
  key: '1',
  epochMs: 1_620_599_040_000,
  cameras: [
    {
      cameraId: 1,
      label: 'cam-01',
      caption: 'Камера cam-01 · Aire, FR · трекинг MCMT + обратная проекция треков на кадр',
      videoUrl: '/demo/Relaxing_highway_traffic.mp4',
      videoSize: { width: 1280, height: 720 },
      geoPoints: [
        { lat: 45.526646, lon: 5.974535, px: 0.328125, py: 0.483333333333333 },
        { lat: 45.527566, lon: 5.973849, px: 0.39765625, py: 0.393055555555556 },
        { lat: 45.527904, lon: 5.974135, px: 0.57109375, py: 0.390277777777778 },
        { lat: 45.526867, lon: 5.974826, px: 0.65625, py: 0.476388888888889 },
      ],
    },
  ],
};

/**
 * Two synchronised cameras of the Auburn / Toomer's Corner intersection. The
 * source clips are 340 s long; the demo serves 60..200 s of each, so position 0
 * of the trimmed file is original frame 1800 (t = 60 s) and the first protocol
 * timestamp is 1620599100000. Both cameras were exported with the same
 * `--geo-origin 32.606456,-85.481891`, so their world coordinates line up on
 * one map.
 */
export const AUBURN_DEMO: DemoScene = {
  key: 'auburn',
  epochMs: 1_620_599_100_000,
  cameras: [
    {
      cameraId: 1,
      label: 'cam-01',
      caption: 'Камера cam-01 · Auburn, AL · Toomer’s Corner',
      videoUrl: '/demo/auburn-cam-01.mp4',
      videoSize: { width: 1920, height: 1080 },
      // data/auburn_toomer/sync_videos/1_2021-05-09_22_24.ini
      geoPoints: [
        { lat: 32.606402, lon: -85.481739, px: 0.0588541666666667, py: 0.75 },
        { lat: 32.606318, lon: -85.482046, px: 0.534895833333333, py: 0.527777777777778 },
        { lat: 32.606573, lon: -85.481934, px: 0.928125, py: 0.803703703703704 },
        { lat: 32.606531, lon: -85.481845, px: 0.606770833333333, py: 0.889814814814815 },
      ],
    },
    {
      cameraId: 2,
      label: 'cam-02',
      caption: 'Камера cam-02 · Auburn, AL · College St',
      videoUrl: '/demo/auburn-cam-02.mp4',
      videoSize: { width: 1920, height: 1080 },
      // data/auburn_toomer/sync_videos/2_2021-05-09_22_24.ini
      geoPoints: [
        { lat: 32.606402, lon: -85.481739, px: 0.175520833333333, py: 0.616666666666667 },
        { lat: 32.606358, lon: -85.482047, px: 0.466666666666667, py: 0.327777777777778 },
        { lat: 32.606573, lon: -85.481934, px: 0.865625, py: 0.47962962962963 },
        { lat: 32.606531, lon: -85.481845, px: 0.750520833333333, py: 0.559259259259259 },
      ],
    },
  ],
};

/** Resolves `?demo=`; an unknown value falls back to the Aire scene. */
export function demoSceneFromSearch(search: string): DemoScene {
  const key = new URLSearchParams(search).get('demo');
  return key === AUBURN_DEMO.key ? AUBURN_DEMO : AIRE_DEMO;
}

/** Back-compat aliases for the original single-camera Aire demo. */
export const DEMO_EPOCH_MS = AIRE_DEMO.epochMs;
export const DEMO_VIDEO_URL = AIRE_DEMO.cameras[0].videoUrl;
export const DEMO_VIDEO_SIZE = AIRE_DEMO.cameras[0].videoSize;
export const DEMO_GEO_POINTS = AIRE_DEMO.cameras[0].geoPoints;

/** Per-object colour palette: vivid hues spread by the golden angle. */
export function trackColor(id: number): string {
  const hue = (id * 137.508) % 360;
  return `hsl(${hue.toFixed(1)}, 92%, 62%)`;
}
