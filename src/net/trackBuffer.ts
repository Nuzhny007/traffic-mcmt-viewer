import type { TrackUpdate, Vec2 } from '../types/tracking';

/** Client-side representation of a live track (protocol track + local trail). */
export interface LiveTrack {
  id: number;
  cameraId: number;
  className: string;
  position: Vec2;
  velocity: Vec2;
  /** Speed in km/h. Uses `speed_kmh` when provided, otherwise |velocity|. */
  speedKmh: number;
  trail: Vec2[];
  /** Wall-clock time (ms) when the last update was applied. */
  lastSeen: number;
}

const MAX_TRAIL_POINTS = 40;
/** Squared distance in degrees (~0.1 m) below which a point is not appended. */
const TRAIL_EPSILON_SQ = 1e-12;

function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function pushTrailPoint(trail: Vec2[], point: Vec2): void {
  const last = trail[trail.length - 1];
  if (last && distanceSq(last, point) < TRAIL_EPSILON_SQ) {
    return;
  }
  trail.push([point[0], point[1]]);
  if (trail.length > MAX_TRAIL_POINTS) {
    trail.splice(0, trail.length - MAX_TRAIL_POINTS);
  }
}

/**
 * Mutable, React-free store for high-frequency track data.
 *
 * The WebSocket feed writes here on every message; the deck.gl overlay reads
 * `list()` from its own rAF loop. `version` lets the overlay skip rebuilding
 * layers when nothing changed, so messages never trigger React renders.
 */
export class TrackBuffer {
  private readonly tracks = new Map<number, LiveTrack>();
  private revision = 0;
  private cachedList: LiveTrack[] | null = null;

  get size(): number {
    return this.tracks.size;
  }

  /** Increments on every data change; cheap change detector for the renderer. */
  get version(): number {
    return this.revision;
  }

  get(id: number): LiveTrack | undefined {
    return this.tracks.get(id);
  }

  /** Cached array, rebuilt after each change. Do not mutate. */
  list(): LiveTrack[] {
    if (!this.cachedList) {
      this.cachedList = Array.from(this.tracks.values());
    }
    return this.cachedList;
  }

  apply(
    updates: readonly TrackUpdate[],
    mode: 'delta' | 'snapshot',
    now: number,
  ): void {
    if (mode === 'snapshot') {
      this.tracks.clear();
    }

    let changed = mode === 'snapshot';

    for (const update of updates) {
      const position: Vec2 = [update.position[0], update.position[1]];
      const existing = this.tracks.get(update.global_id);

      let trail: Vec2[];
      if (update.trail && update.trail.length > 0) {
        trail = update.trail.slice(-MAX_TRAIL_POINTS).map(
          ([lon, lat]): Vec2 => [lon, lat],
        );
      } else if (existing) {
        trail = existing.trail;
        pushTrailPoint(trail, position);
      } else {
        trail = [position];
      }

      const velocity: Vec2 = update.velocity
        ? [update.velocity[0], update.velocity[1]]
        : existing
          ? [existing.velocity[0], existing.velocity[1]]
          : [0, 0];

      let speedKmh: number;
      if (update.speed_kmh !== undefined) {
        speedKmh = update.speed_kmh;
      } else if (update.velocity) {
        speedKmh = Math.hypot(velocity[0], velocity[1]) * 3.6;
      } else {
        speedKmh = existing?.speedKmh ?? 0;
      }

      this.tracks.set(update.global_id, {
        id: update.global_id,
        cameraId: update.camera_id,
        className: update.class,
        position,
        velocity,
        speedKmh,
        trail,
        lastSeen: now,
      });
      changed = true;
    }

    if (changed) {
      this.bump();
    }
  }

  /**
   * Removes tracks reported by the backend (`tracks_remove`).
   * Returns the number of tracks that were actually present.
   */
  remove(ids: readonly number[]): number {
    let removed = 0;
    for (const id of ids) {
      if (this.tracks.delete(id)) {
        removed += 1;
      }
    }
    if (removed > 0) {
      this.bump();
    }
    return removed;
  }

  /** Re-keys a track after the backend reports a ReID merge. */
  mergeIds(oldId: number, newId: number): void {
    if (oldId === newId) {
      return;
    }
    const oldTrack = this.tracks.get(oldId);
    if (!oldTrack) {
      return;
    }

    this.tracks.delete(oldId);
    const existing = this.tracks.get(newId);
    if (!existing) {
      this.tracks.set(newId, { ...oldTrack, id: newId });
    }
    this.bump();
  }

  /** Drops tracks that have not been updated for `ttlMs`. Returns removed count. */
  prune(ttlMs: number, now: number): number {
    let removed = 0;
    for (const [id, track] of this.tracks) {
      if (now - track.lastSeen > ttlMs) {
        this.tracks.delete(id);
        removed += 1;
      }
    }
    if (removed > 0) {
      this.bump();
    }
    return removed;
  }

  clear(): void {
    if (this.tracks.size === 0) {
      return;
    }
    this.tracks.clear();
    this.bump();
  }

  private bump(): void {
    this.revision += 1;
    this.cachedList = null;
  }
}
