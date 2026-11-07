import { create } from 'zustand';

import type { CameraZone, ConnectionStatus } from '../types/tracking';

interface TrackingState {
  connection: ConnectionStatus;
  reconnectAttempt: number;
  zones: Map<number, CameraZone>;
  selectedId: number | null;
  trackCount: number;
  messageRate: number;
  lastMessageAt: number | null;
  setConnection: (status: ConnectionStatus, attempt?: number) => void;
  setZones: (zones: CameraZone[]) => void;
  setStats: (stats: {
    trackCount?: number;
    messageRate?: number;
    lastMessageAt?: number | null;
  }) => void;
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
  messageRate: 0,
  lastMessageAt: null,

  setConnection: (connection, reconnectAttempt = 0) =>
    set({ connection, reconnectAttempt }),

  setZones: (zones) =>
    set({ zones: new Map(zones.map((zone) => [zone.camera_id, zone])) }),

  setStats: (stats) => set(stats),

  select: (selectedId) => set({ selectedId }),

  reset: () =>
    set({
      connection: 'idle',
      reconnectAttempt: 0,
      zones: new Map(),
      selectedId: null,
      trackCount: 0,
      messageRate: 0,
      lastMessageAt: null,
    }),
}));
