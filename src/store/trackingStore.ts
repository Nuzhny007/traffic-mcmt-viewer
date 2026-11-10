import { create } from 'zustand';

import type { CameraZone, ConnectionStatus } from '../types/tracking';

interface TrackingState {
  connection: ConnectionStatus;
  reconnectAttempt: number;
  zones: Map<number, CameraZone>;
  selectedId: number | null;
  trackCount: number;
  /** Tracks left after the view filter; updated by the renderer. */
  visibleCount: number;
  messageRate: number;
  lastMessageAt: number | null;
  classCounts: Record<string, number>;
  cameraCounts: Record<number, number>;
  setConnection: (status: ConnectionStatus, attempt?: number) => void;
  setZones: (zones: CameraZone[]) => void;
  setStats: (stats: {
    trackCount?: number;
    messageRate?: number;
    lastMessageAt?: number | null;
    classCounts?: Record<string, number>;
    cameraCounts?: Record<number, number>;
  }) => void;
  setVisibleCount: (count: number) => void;
  select: (id: number | null) => void;
  reset: () => void;
}

/**
 * Low-frequency UI state only. High-frequency track data lives in the mutable
 * `TrackBuffer` (`src/net/trackBuffer.ts`) so WebSocket messages never trigger
 * React renders; the deck.gl overlay reads the buffer from its rAF loop.
 */
export const useTrackingStore = create<TrackingState>((set) => ({
  connection: 'idle',
  reconnectAttempt: 0,
  zones: new Map(),
  selectedId: null,
  trackCount: 0,
  visibleCount: 0,
  messageRate: 0,
  lastMessageAt: null,
  classCounts: {},
  cameraCounts: {},

  setConnection: (connection, reconnectAttempt = 0) =>
    set({ connection, reconnectAttempt }),

  setZones: (zones) =>
    set({ zones: new Map(zones.map((zone) => [zone.camera_id, zone])) }),

  setStats: (stats) => set(stats),

  setVisibleCount: (visibleCount) => set({ visibleCount }),

  select: (selectedId) => set({ selectedId }),

  reset: () =>
    set({
      connection: 'idle',
      reconnectAttempt: 0,
      zones: new Map(),
      selectedId: null,
      trackCount: 0,
      visibleCount: 0,
      messageRate: 0,
      lastMessageAt: null,
      classCounts: {},
      cameraCounts: {},
    }),
}));
