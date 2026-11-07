import { create } from 'zustand';

import type {
  EmissionGridMessage,
  EmissionStats,
  Pollutant,
} from '../types/emissions';
import { POLLUTANTS } from '../types/emissions';

type EmissionStatsByPollutant = Partial<Record<Pollutant, EmissionStats>>;

interface EmissionState {
  /** True once at least one concentration frame has been received. */
  available: boolean;
  visible: boolean;
  pollutant: Pollutant;
  timestamp: number | null;
  cols: number;
  rows: number;
  stats: EmissionStatsByPollutant;
  setVisible: (visible: boolean) => void;
  setPollutant: (pollutant: Pollutant) => void;
  setFrameMeta: (frame: EmissionGridMessage) => void;
  reset: () => void;
}

function collectStats(
  frame: EmissionGridMessage,
): EmissionStatsByPollutant {
  const stats: EmissionStatsByPollutant = {};
  for (const pollutant of POLLUTANTS) {
    const field = frame.fields[pollutant];
    if (field) {
      stats[pollutant] = {
        max: field.max,
        mean: field.mean,
        p95: field.p95,
      };
    }
  }
  return stats;
}

/**
 * Low-frequency UI state for the emission overlay. The raster itself lives in
 * the mutable `EmissionBuffer`; only its metadata is copied here so the panel
 * can re-render without touching the float arrays.
 */
export const useEmissionStore = create<EmissionState>((set) => ({
  available: false,
  visible: true,
  pollutant: 'NOx',
  timestamp: null,
  cols: 0,
  rows: 0,
  stats: {},

  setVisible: (visible) => set({ visible }),

  setPollutant: (pollutant) => set({ pollutant }),

  setFrameMeta: (frame) =>
    set({
      available: true,
      timestamp: frame.timestamp,
      cols: frame.cols,
      rows: frame.rows,
      stats: collectStats(frame),
    }),

  reset: () =>
    set({
      available: false,
      visible: true,
      pollutant: 'NOx',
      timestamp: null,
      cols: 0,
      rows: 0,
      stats: {},
    }),
}));
