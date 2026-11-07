/** Protocol types for the TrafficMCMT WebSocket stream (v1). */

import type { EmissionGridMessage } from './emissions';

export type Vec2 = [number, number];
export type RGBA = [number, number, number, number];

/** WebSocket connection lifecycle used by the UI. */
export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed';

export interface TrackUpdate {
  global_id: number;
  camera_id: number;
  /** Object class: car | truck | bus | person | bike | unknown */
  class: string;
  /** [lon, lat] */
  position: Vec2;
  /** [vx, vy] in m/s, optional */
  velocity?: Vec2;
  /** Speed in km/h, optional. Falls back to `hypot(velocity) * 3.6`. */
  speed_kmh?: number;
  /** Reserved for future ReID features */
  embedding?: number[];
  /** Optional history: [[lon, lat], ...] */
  trail?: Vec2[];
}

export interface CameraZone {
  camera_id: number;
  polygon: Vec2[];
  color: RGBA;
}

export interface TracksUpdateMessage {
  type: 'tracks_update';
  /** Unix time, seconds or milliseconds */
  timestamp: number;
  /** delta (default) or full snapshot */
  mode?: 'delta' | 'snapshot';
  tracks: TrackUpdate[];
  camera_zones?: CameraZone[];
}

export interface CameraZonesMessage {
  type: 'camera_zones';
  timestamp?: number;
  camera_zones: CameraZone[];
}

export interface IdMergeMessage {
  type: 'id_merge';
  old_id: number;
  new_id: number;
  timestamp?: number;
}

/** Additive v1 extension: the backend expired these tracks. */
export interface TracksRemoveMessage {
  type: 'tracks_remove';
  ids: number[];
  timestamp?: number;
}

export interface HeartbeatMessage {
  type: 'heartbeat';
  timestamp?: number;
}

export type ServerMessage =
  | TracksUpdateMessage
  | CameraZonesMessage
  | IdMergeMessage
  | TracksRemoveMessage
  | HeartbeatMessage
  | EmissionGridMessage;
