import type { Vec2 } from '../types/tracking';

/** The part of a live track the motion model needs. */
export interface MotionTrack {
  position: Vec2;
  /** `[vx, vy]` in m/s, east/north. */
  velocity: Vec2;
  /** Monotonic time (ms) of the last received update. */
  lastSeen: number;
}

/**
 * Upper bound on dead reckoning. Frames arrive at 10 Hz, so a short window hides
 * the step between updates; extrapolating further would show a car driving
 * through an intersection it never reached.
 */
export const MAX_EXTRAPOLATION_MS = 150;

/** Below this speed the direction is noise, so the position is not moved. */
const MIN_SPEED_MPS = 0.1;

const METERS_PER_DEG_LAT = 110_540;
const METERS_PER_DEG_LON_EQUATOR = 111_320;

/**
 * Dead reckoning from the last known position along the last known velocity.
 *
 * `atMs === null` disables the motion model and returns the raw position, which
 * is what the `VITE_MAP_ANIMATE=false` switch does.
 */
export function deadReckon(track: MotionTrack, atMs: number | null): Vec2 {
  if (atMs === null) {
    return track.position;
  }

  const dt = Math.min(Math.max(atMs - track.lastSeen, 0), MAX_EXTRAPOLATION_MS) / 1000;
  if (dt <= 0) {
    return track.position;
  }

  const [vx, vy] = track.velocity;
  if (!Number.isFinite(vx) || !Number.isFinite(vy) || Math.hypot(vx, vy) < MIN_SPEED_MPS) {
    return track.position;
  }

  const latitude = track.position[1];
  const metersPerDegLon = METERS_PER_DEG_LON_EQUATOR * Math.cos((latitude * Math.PI) / 180);
  if (!(metersPerDegLon > 1)) {
    // Near the poles the longitude scale degenerates; keep the last fix.
    return track.position;
  }

  return [
    track.position[0] + (vx * dt) / metersPerDegLon,
    track.position[1] + (vy * dt) / METERS_PER_DEG_LAT,
  ];
}

/** True when `head` is far enough from `tail` to be worth appending. */
function isDistinct(tail: Vec2 | undefined, head: Vec2): boolean {
  if (!tail) {
    return true;
  }
  const dx = tail[0] - head[0];
  const dy = tail[1] - head[1];
  // ~1 cm: below that the extra vertex only costs an attribute slot.
  return dx * dx + dy * dy > 1e-12;
}

/**
 * Trail plus the extrapolated head, so the path ends exactly at the animated
 * marker instead of lagging one frame behind it.
 */
export function trailWithHead(trail: Vec2[], head: Vec2): Vec2[] {
  if (!isDistinct(trail[trail.length - 1], head)) {
    return trail;
  }
  return [...trail, head];
}

/**
 * Opacity multiplier for a track that has not been updated for `ageMs`.
 *
 * The gateway removes a track after 3 s (`feed.track_ttl_s`), the client TTL is
 * 8 s; fading over the local TTL keeps a dropped track visible long enough to
 * notice instead of blinking out.
 */
export function fadeAlpha(ageMs: number, ttlMs: number): number {
  if (!(ttlMs > 0) || ageMs <= 0) {
    return 1;
  }
  const fadeStart = Math.min(2_000, ttlMs * 0.25);
  if (ageMs <= fadeStart) {
    return 1;
  }
  const span = Math.max(1, ttlMs - fadeStart);
  return Math.max(0, Math.min(1, 1 - (ageMs - fadeStart) / span));
}
