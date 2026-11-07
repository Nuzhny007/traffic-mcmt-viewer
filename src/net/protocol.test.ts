import { describe, expect, it } from 'vitest';

import { parseServerMessage } from './protocol';

/** Little-endian float32 base64, mirroring the C++ `MapProtocol` writer. */
function encodeFloat32(values: number[]): string {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

describe('parseServerMessage', () => {
  it('parses a tracks_update message', () => {
    const message = parseServerMessage(
      JSON.stringify({
        type: 'tracks_update',
        timestamp: 123,
        mode: 'snapshot',
        tracks: [
          {
            global_id: 7,
            camera_id: 2,
            class: 'truck',
            position: [5.97, 45.52],
            velocity: [1.5, -2],
          },
        ],
      }),
    );

    expect(message?.type).toBe('tracks_update');
    if (message?.type !== 'tracks_update') {
      return;
    }
    expect(message.mode).toBe('snapshot');
    expect(message.tracks).toHaveLength(1);
    expect(message.tracks[0]).toMatchObject({
      global_id: 7,
      camera_id: 2,
      class: 'truck',
      position: [5.97, 45.52],
    });
  });

  it('defaults mode to delta and drops invalid tracks', () => {
    const message = parseServerMessage(
      JSON.stringify({
        type: 'tracks_update',
        tracks: [
          { global_id: 1, camera_id: 1, position: [5.0, 45.0] },
          { global_id: 'bad', camera_id: 1, position: [5.0, 45.0] },
          { global_id: 2, camera_id: 1, position: [5.0] },
        ],
      }),
    );

    if (message?.type !== 'tracks_update') {
      throw new Error('expected tracks_update');
    }
    expect(message.mode).toBe('delta');
    expect(message.tracks).toHaveLength(1);
    expect(message.tracks[0]?.class).toBe('unknown');
  });

  it('parses camera zones', () => {
    const message = parseServerMessage(
      JSON.stringify({
        type: 'camera_zones',
        camera_zones: [
          {
            camera_id: 3,
            polygon: [
              [5.0, 45.0],
              [5.1, 45.0],
              [5.1, 45.1],
            ],
            color: [1, 2, 3, 4],
          },
        ],
      }),
    );

    if (message?.type !== 'camera_zones') {
      throw new Error('expected camera_zones');
    }
    expect(message.camera_zones).toHaveLength(1);
    expect(message.camera_zones[0]?.camera_id).toBe(3);
  });

  it('parses id merges', () => {
    const message = parseServerMessage(
      JSON.stringify({ type: 'id_merge', old_id: 10, new_id: 20 }),
    );

    expect(message).toEqual({
      type: 'id_merge',
      old_id: 10,
      new_id: 20,
      timestamp: undefined,
    });
  });

  it('parses speed_kmh', () => {
    const message = parseServerMessage(
      JSON.stringify({
        type: 'tracks_update',
        tracks: [
          {
            global_id: 1,
            camera_id: 1,
            position: [5.0, 45.0],
            velocity: [10, 0],
            speed_kmh: 42.5,
          },
        ],
      }),
    );

    if (message?.type !== 'tracks_update') {
      throw new Error('expected tracks_update');
    }
    expect(message.tracks[0]?.speed_kmh).toBe(42.5);
  });

  it('parses tracks_remove and drops invalid ids', () => {
    const message = parseServerMessage(
      JSON.stringify({
        type: 'tracks_remove',
        timestamp: 123,
        ids: [1, 'bad', 2, null],
      }),
    );

    expect(message).toEqual({
      type: 'tracks_remove',
      ids: [1, 2],
      timestamp: 123,
    });
  });

  it('parses an emission grid and decodes the float raster', () => {
    const message = parseServerMessage(
      JSON.stringify({
        type: 'emission_grid',
        timestamp: 1234,
        unit: 'ug/m3',
        bounds: { west: 5, south: 45, east: 5.1, north: 45.1 },
        cols: 2,
        rows: 2,
        fields: {
          NOx: {
            data: encodeFloat32([1, 2, 3, 4]),
            max: 4,
            mean: 2.5,
            p95: 3.9,
          },
          CO: { data: 'not-base64', max: 1, mean: 0, p95: 0 },
        },
      }),
    );

    if (message?.type !== 'emission_grid') {
      throw new Error('expected emission_grid');
    }
    expect(message.timestamp).toBe(1234);
    expect(message.cols).toBe(2);
    expect(message.rows).toBe(2);
    expect(message.fields.NOx?.data).toBeInstanceOf(Float32Array);
    expect(Array.from(message.fields.NOx?.data ?? [])).toEqual([1, 2, 3, 4]);
    expect(message.fields.NOx?.p95).toBeCloseTo(3.9, 5);
    // The malformed CO field is dropped, the valid one keeps the frame alive.
    expect(message.fields.CO).toBeUndefined();
  });

  it('rejects malformed emission grids', () => {
    const valid = {
      type: 'emission_grid',
      timestamp: 1,
      bounds: { west: 5, south: 45, east: 5.1, north: 45.1 },
      cols: 2,
      rows: 2,
      fields: { NOx: { data: encodeFloat32([1, 2, 3, 4]) } },
    };

    expect(parseServerMessage(JSON.stringify(valid))).not.toBeNull();
    // Raster size must match cols * rows.
    expect(
      parseServerMessage(
        JSON.stringify({
          ...valid,
          fields: { NOx: { data: encodeFloat32([1, 2]) } },
        }),
      ),
    ).toBeNull();
    // Inverted bounds.
    expect(
      parseServerMessage(
        JSON.stringify({
          ...valid,
          bounds: { west: 5.1, south: 45, east: 5, north: 45.1 },
        }),
      ),
    ).toBeNull();
    // No usable field.
    expect(
      parseServerMessage(JSON.stringify({ ...valid, fields: {} })),
    ).toBeNull();
  });

  it('returns null for invalid input', () => {
    expect(parseServerMessage('not json')).toBeNull();
    expect(parseServerMessage('null')).toBeNull();
    expect(parseServerMessage('{"type":"unknown"}')).toBeNull();
    expect(parseServerMessage('{"type":"tracks_update"}')).toBeNull();
    expect(parseServerMessage('{"type":"tracks_remove"}')).toBeNull();
  });
});
