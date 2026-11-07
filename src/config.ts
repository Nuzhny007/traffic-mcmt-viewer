const env = import.meta.env;

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

export const appConfig = {
  wsUrl: env.VITE_WS_URL ?? 'ws://localhost:8080/ws',
  /**
   * Reconnect after this much silence. The C++ map gateway does not emit
   * heartbeats yet, so the default is deliberately longer than the intended
   * 5 s heartbeat interval.
   */
  wsTimeoutMs: num(env.VITE_WS_TIMEOUT_MS, 60_000),
  /** Drop tracks that have not been updated for this long. */
  trackTtlMs: num(env.VITE_TRACK_TTL_MS, 8_000),
  /** Fit the map once to the first camera zones (or tracks if there are none). */
  mapAutofit: bool(env.VITE_MAP_AUTOFIT, true),
  mapStyle:
    env.VITE_MAP_STYLE ??
    'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  initialView: {
    longitude: num(env.VITE_MAP_LON, 5.9745),
    latitude: num(env.VITE_MAP_LAT, 45.5268),
    zoom: num(env.VITE_MAP_ZOOM, 16),
    pitch: 0,
    bearing: 0,
  },
} as const;
