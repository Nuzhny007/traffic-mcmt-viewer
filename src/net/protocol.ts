import type {
  CameraZone,
  ServerMessage,
  TrackUpdate,
  Vec2,
} from '../types/tracking';
import {
  POLLUTANTS,
  type EmissionBounds,
  type EmissionField,
  type EmissionGridMessage,
  type Pollutant,
} from '../types/emissions';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isVec2(value: unknown): value is Vec2 {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1])
  );
}

/** Decodes the little-endian float32 payload of one raster field. */
function decodeBase64Float32(text: string): Float32Array | null {
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    return null;
  }
  if (binary.length === 0 || binary.length % 4 !== 0) {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const values = new Float32Array(binary.length / 4);
  for (let i = 0; i < values.length; i += 1) {
    values[i] = view.getFloat32(i * 4, true);
  }
  return values;
}

function finiteStat(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

function parseEmissionField(
  value: unknown,
  cells: number,
): EmissionField | null {
  if (!isRecord(value) || typeof value.data !== 'string') {
    return null;
  }
  const data = decodeBase64Float32(value.data);
  if (!data || data.length !== cells) {
    return null;
  }
  return {
    data,
    max: finiteStat(value.max),
    mean: finiteStat(value.mean),
    p95: finiteStat(value.p95),
  };
}

function parseEmissionGrid(value: unknown): EmissionGridMessage | null {
  if (!isRecord(value) || !isRecord(value.bounds)) {
    return null;
  }
  const west = value.bounds.west;
  const south = value.bounds.south;
  const east = value.bounds.east;
  const north = value.bounds.north;
  if (
    typeof west !== 'number' ||
    typeof south !== 'number' ||
    typeof east !== 'number' ||
    typeof north !== 'number' ||
    !Number.isFinite(west) ||
    !Number.isFinite(south) ||
    !Number.isFinite(east) ||
    !Number.isFinite(north) ||
    west >= east ||
    south >= north
  ) {
    return null;
  }

  const { cols, rows } = value;
  if (
    typeof cols !== 'number' ||
    !Number.isSafeInteger(cols) ||
    cols <= 0 ||
    typeof rows !== 'number' ||
    !Number.isSafeInteger(rows) ||
    rows <= 0
  ) {
    return null;
  }
  const cells = cols * rows;
  const fieldsNode = value.fields;
  // A hostile or corrupt frame must not allocate an unbounded raster.
  if (cells > 4_000_000 || !isRecord(fieldsNode)) {
    return null;
  }

  const fields: Partial<Record<Pollutant, EmissionField>> = {};
  for (const pollutant of POLLUTANTS) {
    const field = parseEmissionField(fieldsNode[pollutant], cells);
    if (field) {
      fields[pollutant] = field;
    }
  }
  if (Object.keys(fields).length === 0) {
    return null;
  }

  const bounds: EmissionBounds = { west, south, east, north };
  return {
    type: 'emission_grid',
    timestamp:
      typeof value.timestamp === 'number' && Number.isFinite(value.timestamp)
        ? value.timestamp
        : Date.now(),
    unit: typeof value.unit === 'string' ? value.unit : 'ug/m3',
    bounds,
    cols,
    rows,
    fields,
  };
}

function parseTrack(value: unknown): TrackUpdate | null {
  if (!isRecord(value)) {
    return null;
  }
  const { global_id, camera_id, position } = value;
  if (
    typeof global_id !== 'number' ||
    !Number.isSafeInteger(global_id) ||
    global_id <= 0 ||
    typeof camera_id !== 'number' ||
    !Number.isSafeInteger(camera_id) ||
    !isVec2(position)
  ) {
    return null;
  }

  const trail = Array.isArray(value.trail)
    ? value.trail.filter(isVec2).slice(-64)
    : undefined;

  const speed =
    typeof value.speed_kmh === 'number' && Number.isFinite(value.speed_kmh)
      ? Math.max(0, value.speed_kmh)
      : undefined;

  return {
    global_id,
    camera_id,
    class: typeof value.class === 'string' ? value.class : 'unknown',
    position,
    velocity: isVec2(value.velocity) ? value.velocity : undefined,
    speed_kmh: speed,
    trail,
  };
}

function parseZone(value: unknown): CameraZone | null {
  if (!isRecord(value)) {
    return null;
  }
  const { camera_id, polygon, color } = value;
  if (
    typeof camera_id !== 'number' ||
    !Number.isSafeInteger(camera_id) ||
    !Array.isArray(polygon) ||
    polygon.length < 3
  ) {
    return null;
  }
  const points = polygon.filter(isVec2);
  if (points.length < 3) {
    return null;
  }
  return {
    camera_id,
    polygon: points,
    color:
      Array.isArray(color) &&
      color.length === 4 &&
      color.every((channel) => typeof channel === 'number')
        ? [color[0], color[1], color[2], color[3]]
        : [148, 163, 184, 55],
  };
}

function parseZones(value: unknown): CameraZone[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .map(parseZone)
    .filter((zone): zone is CameraZone => zone !== null);
}

/**
 * Parses and validates one WebSocket text frame.
 * Returns `null` for malformed or unknown messages instead of throwing, so a
 * single bad frame never tears down the feed.
 */
export function parseServerMessage(raw: string): ServerMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(value) || typeof value.type !== 'string') {
    return null;
  }

  switch (value.type) {
    case 'tracks_update': {
      if (!Array.isArray(value.tracks)) {
        return null;
      }
      const tracks = value.tracks
        .map(parseTrack)
        .filter((track): track is TrackUpdate => track !== null);
      return {
        type: 'tracks_update',
        timestamp:
          typeof value.timestamp === 'number' ? value.timestamp : Date.now(),
        mode: value.mode === 'snapshot' ? 'snapshot' : 'delta',
        tracks,
        camera_zones: parseZones(value.camera_zones),
      };
    }
    case 'camera_zones': {
      const zones = parseZones(value.camera_zones);
      if (!zones) {
        return null;
      }
      return {
        type: 'camera_zones',
        timestamp:
          typeof value.timestamp === 'number' ? value.timestamp : undefined,
        camera_zones: zones,
      };
    }
    case 'id_merge': {
      if (
        typeof value.old_id !== 'number' ||
        !Number.isSafeInteger(value.old_id) ||
        value.old_id <= 0 ||
        typeof value.new_id !== 'number' ||
        !Number.isSafeInteger(value.new_id) ||
        value.new_id <= 0
      ) {
        return null;
      }
      return {
        type: 'id_merge',
        old_id: value.old_id,
        new_id: value.new_id,
        timestamp:
          typeof value.timestamp === 'number' ? value.timestamp : undefined,
      };
    }
    case 'tracks_remove': {
      if (!Array.isArray(value.ids)) {
        return null;
      }
      const ids = value.ids.filter(
        (id): id is number =>
          typeof id === 'number' && Number.isSafeInteger(id) && id > 0,
      );
      return {
        type: 'tracks_remove',
        ids,
        timestamp:
          typeof value.timestamp === 'number' ? value.timestamp : undefined,
      };
    }
    case 'heartbeat':
      return {
        type: 'heartbeat',
        timestamp:
          typeof value.timestamp === 'number' ? value.timestamp : undefined,
      };
    case 'emission_grid':
      return parseEmissionGrid(value);
    default:
      return null;
  }
}
