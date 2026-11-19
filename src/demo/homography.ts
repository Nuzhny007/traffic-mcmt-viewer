/**
 * Homography between WGS-84 degrees and normalised image pixels, rebuilt from
 * the same `geo_bind.ini` control points the C++ `GeoBinding` uses.
 *
 * The gateway projects image pixels -> ground with a homography; the inverse
 * mapping ground -> pixels is itself a homography, and four exact point pairs
 * determine it uniquely, so a DLT solve on those pairs reproduces the inverse
 * of what the backend does. This is what lets the demo video overlay draw the
 * WS tracks on top of the camera frame.
 */

export interface GeoPointPx {
  /** Latitude in degrees. */
  lat: number;
  /** Longitude in degrees. */
  lon: number;
  /** Normalised pixel x in [0, 1]. */
  px: number;
  /** Normalised pixel y in [0, 1]. */
  py: number;
}

export type Homography = readonly [number, number, number, number, number, number, number, number, number];

/** Solves the linear system `A x = b` (square, Gaussian elimination). */
function solveLinearSystem(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) {
        pivot = row;
      }
    }
    if (Math.abs(m[pivot][col]) < 1e-12) {
      return null;
    }
    [m[col], m[pivot]] = [m[pivot], m[col]];

    const diagonal = m[col][col];
    for (let row = 0; row < n; row += 1) {
      if (row === col) {
        continue;
      }
      const factor = m[row][col] / diagonal;
      for (let k = col; k <= n; k += 1) {
        m[row][k] -= factor * m[col][k];
      }
    }
  }

  return m.map((row, i) => row[n] / row[i]);
}

/**
 * Builds the homography mapping `[lon, lat, 1]` to normalised pixels.
 * Returns `null` when the four points are degenerate (collinear/duplicate).
 */
export function homographyFromPoints(points: readonly GeoPointPx[]): Homography | null {
  if (points.length !== 4) {
    return null;
  }

  const a: number[][] = [];
  const b: number[] = [];
  for (const { lon, lat, px, py } of points) {
    a.push([lon, lat, 1, 0, 0, 0, -px * lon, -px * lat]);
    b.push(px);
    a.push([0, 0, 0, lon, lat, 1, -py * lon, -py * lat]);
    b.push(py);
  }

  const solution = solveLinearSystem(a, b);
  if (!solution || solution.length !== 8) {
    return null;
  }
  // h22 is fixed to 1 by the DLT parametrisation.
  return [solution[0], solution[1], solution[2], solution[3], solution[4], solution[5], solution[6], solution[7], 1];
}

/** Applies the homography to `[lon, lat]`, returning normalised pixels. */
export function applyHomography(
  h: Homography,
  lon: number,
  lat: number,
): { x: number; y: number } {
  const denominator = h[6] * lon + h[7] * lat + h[8];
  return {
    x: (h[0] * lon + h[1] * lat + h[2]) / denominator,
    y: (h[3] * lon + h[4] * lat + h[5]) / denominator,
  };
}
