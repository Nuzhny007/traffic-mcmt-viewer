import type { TrackClass } from '../domain/classes';
import type { CameraZone, Vec2 } from '../types/tracking';

export interface DemoTrack {
  globalId: number;
  cameraId: number;
  className: TrackClass;
  position: Vec2;
  /** [vx, vy], m/s */
  velocity: Vec2;
  trail: Vec2[];
}

/**
 * Static sample data around Aire (France), matching data/aire/geo_bind.ini.
 * The live app uses the WebSocket feed; this module is kept for unit tests.
 */
const ROAD: Vec2[] = [
  [5.97295, 45.5282],
  [5.97345, 45.52792],
  [5.97395, 45.52764],
  [5.97445, 45.52736],
  [5.97495, 45.52708],
  [5.97545, 45.52678],
  [5.97595, 45.5265],
  [5.9764, 45.52624],
];

const LATERAL_OFFSET = 0.00007;

function offsetPath(path: Vec2[], delta: number): Vec2[] {
  return path.map(([lon, lat], i) => [
    lon + delta,
    lat + (i % 2 === 0 ? delta * 0.35 : -delta * 0.35),
  ]);
}

const TRACK_SPECS: Array<{ className: TrackClass; cameraId: number }> = [
  { className: 'car', cameraId: 1 },
  { className: 'car', cameraId: 2 },
  { className: 'truck', cameraId: 1 },
  { className: 'bus', cameraId: 2 },
  { className: 'car', cameraId: 1 },
  { className: 'bike', cameraId: 2 },
  { className: 'person', cameraId: 1 },
  { className: 'car', cameraId: 2 },
  { className: 'truck', cameraId: 2 },
  { className: 'car', cameraId: 1 },
];

export const DEMO_TRACKS: DemoTrack[] = TRACK_SPECS.map((spec, index) => {
  const start = index % 3;
  const trail = offsetPath(
    ROAD.slice(start, start + 5),
    (index % 2 === 0 ? 1 : -1) * LATERAL_OFFSET * (1 + (index % 3)),
  );
  const position = trail[trail.length - 1];

  return {
    globalId: 100 + index,
    cameraId: spec.cameraId,
    className: spec.className,
    position,
    velocity: [index % 2 === 0 ? 9.5 : -7.2, index % 2 === 0 ? 5.1 : -4.4],
    trail,
  };
});

export const DEMO_ZONES: CameraZone[] = [
  {
    camera_id: 1,
    polygon: [
      [5.9727, 45.52855],
      [5.97425, 45.52855],
      [5.97465, 45.5271],
      [5.97315, 45.5271],
    ],
    color: [239, 68, 68, 55],
  },
  {
    camera_id: 2,
    polygon: [
      [5.9743, 45.52735],
      [5.97615, 45.52735],
      [5.9765, 45.52595],
      [5.97465, 45.52595],
    ],
    color: [59, 130, 246, 55],
  },
];
