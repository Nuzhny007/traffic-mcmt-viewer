/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WS_URL?: string;
  readonly VITE_TRACK_TTL_MS?: string;
  readonly VITE_MAP_STYLE?: string;
  readonly VITE_MAP_LON?: string;
  readonly VITE_MAP_LAT?: string;
  readonly VITE_MAP_ZOOM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
