import type { LiveTrack } from '../net/trackBuffer';
import { ALL_CLASSES, type TrackClass } from './classes';

/** Active track filter, derived from `viewStore`. */
export interface TrackFilter {
  /** Visible classes; never empty (the last one cannot be switched off). */
  classes: readonly TrackClass[];
  /** Visible camera ids; empty means "every camera". */
  cameras: readonly number[];
  /** Hide tracks slower than this; 0 disables the limit. */
  minSpeedKmh: number;
  /** Raw search box contents: `#1042` / `1042` selects by id. */
  query: string;
}

/** Parses `#1042` / `1042`; returns null for anything that is not an id. */
export function parseTrackQuery(query: string): number | null {
  const trimmed = query.trim().replace(/^#/, '');
  if (trimmed === '' || !/^\d+$/.test(trimmed)) {
    return null;
  }
  const id = Number(trimmed);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function matchesFilter(track: LiveTrack, filter: TrackFilter): boolean {
  if (!filter.classes.includes(track.className as TrackClass)) {
    return false;
  }
  if (filter.cameras.length > 0 && !filter.cameras.includes(track.cameraId)) {
    return false;
  }
  if (filter.minSpeedKmh > 0 && track.speedKmh < filter.minSpeedKmh) {
    return false;
  }
  const id = parseTrackQuery(filter.query);
  if (id !== null && track.id !== id) {
    return false;
  }
  return true;
}

/**
 * Filters the live tracks once per change, never per animation frame: at
 * 1000 tracks a per-frame predicate would run 60 000 times per second.
 */
export function filterTracks(
  tracks: readonly LiveTrack[],
  filter: TrackFilter,
): LiveTrack[] {
  // The default filter keeps everything; skip the predicate entirely.
  if (
    filter.classes.length === ALL_CLASSES.length &&
    filter.cameras.length === 0 &&
    filter.minSpeedKmh <= 0 &&
    parseTrackQuery(filter.query) === null
  ) {
    return tracks as LiveTrack[];
  }
  return tracks.filter((track) => matchesFilter(track, filter));
}
