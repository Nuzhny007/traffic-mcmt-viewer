import { create } from 'zustand';

import { ALL_CLASSES, type TrackClass } from '../domain/classes';

/** User-facing view settings. Shared by the control panel and the renderer. */
export interface ViewSettings {
  /** Visible classes, in legend order; never empty. */
  classes: TrackClass[];
  /** Visible camera ids; empty means "every camera". */
  cameras: number[];
  showTrails: boolean;
  showZones: boolean;
  /** Hide tracks slower than this; 0 disables the limit. */
  minSpeedKmh: number;
  /** Search box: `#1042` narrows the map to one track. */
  query: string;
  /** Opacity of the concentration overlay, 0.1–1. */
  emissionOpacity: number;
}

export const MIN_SPEED_LIMIT = 80;
const OPACITY_MIN = 0.1;

export const DEFAULT_VIEW: ViewSettings = {
  classes: [...ALL_CLASSES],
  cameras: [],
  showTrails: true,
  showZones: true,
  minSpeedKmh: 0,
  query: '',
  emissionOpacity: 0.72,
};

/** localStorage key with the last view, used only when the URL has no settings. */
export const VIEW_STORAGE_KEY = 'trafficmcmt-view';

const VIEW_PARAMS = ['classes', 'cams', 'trails', 'zones', 'min_speed', 'q', 'opacity'];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseNumber(value: string | null): number | null {
  if (value === null || value.trim() === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseClasses(value: string | null): TrackClass[] | null {
  if (value === null || value.trim() === '') {
    return null;
  }
  const wanted = new Set(value.split(',').map((item) => item.trim()));
  const classes = ALL_CLASSES.filter((item) => wanted.has(item));
  return classes.length > 0 ? classes : null;
}

function parseCameras(value: string | null): number[] | null {
  if (value === null || value.trim() === '') {
    return null;
  }
  const cameras = value
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  return cameras.length > 0 ? [...new Set(cameras)].sort((a, b) => a - b) : null;
}

/** True when the URL carries at least one recognised view parameter. */
export function hasViewParams(search: string): boolean {
  const params = new URLSearchParams(search);
  return VIEW_PARAMS.some((name) => params.has(name));
}

/**
 * Parses `?classes=car,truck&cams=1&trails=0&min_speed=5&q=1042&opacity=0.6`.
 * Unknown values fall back to the default instead of failing the whole view.
 */
export function parseViewQuery(search: string): ViewSettings {
  const params = new URLSearchParams(search);
  const view: ViewSettings = { ...DEFAULT_VIEW, classes: [...ALL_CLASSES] };

  const classes = parseClasses(params.get('classes'));
  if (classes) {
    view.classes = classes;
  }

  const cameras = parseCameras(params.get('cams'));
  if (cameras) {
    view.cameras = cameras;
  }

  if (params.get('trails') === '0') {
    view.showTrails = false;
  }
  if (params.get('zones') === '0') {
    view.showZones = false;
  }

  const minSpeed = parseNumber(params.get('min_speed'));
  if (minSpeed !== null) {
    view.minSpeedKmh = clamp(minSpeed, 0, MIN_SPEED_LIMIT);
  }

  const query = params.get('q');
  if (query !== null) {
    view.query = query.trim().slice(0, 24);
  }

  const opacity = parseNumber(params.get('opacity'));
  if (opacity !== null) {
    view.emissionOpacity = clamp(opacity, OPACITY_MIN, 1);
  }

  return view;
}

/**
 * Serialises only the settings that differ from the defaults, so a pristine
 * view has a clean URL and shared links stay short.
 */
export function toViewQuery(view: ViewSettings): string {
  const params = new URLSearchParams();

  const classes = ALL_CLASSES.filter((item) => view.classes.includes(item));
  if (classes.length !== ALL_CLASSES.length) {
    params.set('classes', classes.join(','));
  }
  if (view.cameras.length > 0) {
    params.set('cams', view.cameras.join(','));
  }
  if (!view.showTrails) {
    params.set('trails', '0');
  }
  if (!view.showZones) {
    params.set('zones', '0');
  }
  if (view.minSpeedKmh > 0) {
    params.set('min_speed', String(view.minSpeedKmh));
  }
  if (view.query.trim() !== '') {
    params.set('q', view.query.trim());
  }
  if (view.emissionOpacity !== DEFAULT_VIEW.emissionOpacity) {
    params.set('opacity', view.emissionOpacity.toFixed(2));
  }

  return params.toString();
}

function readStoredView(): ViewSettings | null {
  try {
    const raw = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return raw ? parseViewQuery(`?${raw}`) : null;
  } catch {
    // Storage can be disabled by browser policy; the URL still works.
    return null;
  }
}

/** URL wins over storage; storage covers a plain page load without settings. */
function initialView(): ViewSettings {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_VIEW, classes: [...ALL_CLASSES] };
  }
  const search = window.location.search;
  if (hasViewParams(search)) {
    return parseViewQuery(search);
  }
  return readStoredView() ?? parseViewQuery(search);
}

export interface ViewState extends ViewSettings {
  /** Bumped on every change; cheap change detector for the render loop. */
  version: number;
  toggleClass: (className: TrackClass) => void;
  /** Show only this class, or restore all when it is already the only one. */
  onlyClass: (className: TrackClass) => void;
  toggleCamera: (cameraId: number, knownCameras: readonly number[]) => void;
  setShowTrails: (value: boolean) => void;
  setShowZones: (value: boolean) => void;
  setMinSpeed: (value: number) => void;
  setQuery: (value: string) => void;
  setEmissionOpacity: (value: number) => void;
  reset: () => void;
}

export const useViewStore = create<ViewState>((set) => {
  // `classes` is guarded by the actions: an empty filter would render a blank
  // map with no way back except the reset button.
  const apply = (partial: Partial<ViewSettings>) =>
    set((state) => ({ ...partial, version: state.version + 1 }));

  return {
    ...initialView(),
    version: 0,

    toggleClass: (className) => {
      const current = useViewStore.getState().classes;
      const next = current.includes(className)
        ? current.filter((item) => item !== className)
        : ALL_CLASSES.filter((item) => current.includes(item) || item === className);
      if (next.length === 0) {
        return;
      }
      apply({ classes: [...next] });
    },

    onlyClass: (className) => {
      const current = useViewStore.getState().classes;
      const isOnly = current.length === 1 && current[0] === className;
      apply({ classes: isOnly ? [...ALL_CLASSES] : [className] });
    },

    toggleCamera: (cameraId, knownCameras) => {
      const current = useViewStore.getState().cameras;
      // Empty means "all cameras"; the first click materialises the list.
      const base = current.length > 0 ? current : [...knownCameras, cameraId];
      const next = base.includes(cameraId)
        ? base.filter((id) => id !== cameraId)
        : [...base, cameraId].sort((a, b) => a - b);
      if (next.length === 0) {
        return;
      }
      apply({ cameras: next });
    },

    setShowTrails: (value) => apply({ showTrails: value }),
    setShowZones: (value) => apply({ showZones: value }),
    setMinSpeed: (value) => apply({ minSpeedKmh: clamp(value, 0, MIN_SPEED_LIMIT) }),
    setQuery: (value) => apply({ query: value.slice(0, 24) }),
    setEmissionOpacity: (value) =>
      apply({ emissionOpacity: clamp(value, OPACITY_MIN, 1) }),
    reset: () => apply({ ...DEFAULT_VIEW, classes: [...ALL_CLASSES] }),
  };
});

/**
 * Mirrors the view into the URL and localStorage. Called once from `App`:
 * a deep link keeps working across reloads and can be shared as-is.
 */
export function startViewSync(): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  return useViewStore.subscribe((state) => {
    const query = toViewQuery(state);
    const url = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState(null, '', url);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, query);
    } catch {
      // Ignore storage quota/policy errors: the URL already carries the state.
    }
  });
}
