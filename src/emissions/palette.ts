import type { EmissionGridMessage, Pollutant } from '../types/emissions';

export interface RampStop {
  /** Position on the ramp, 0..1. */
  t: number;
  rgb: readonly [number, number, number];
}

export interface PollutantInfo {
  label: string;
  description: string;
  stops: readonly RampStop[];
}

/**
 * Per-pollutant colour ramps. They are deliberately distinct so switching the
 * selector is obvious, and all of them stay readable over the dark basemap.
 */
export const POLLUTANT_INFO: Record<Pollutant, PollutantInfo> = {
  NOx: {
    label: 'NOx',
    description: 'Оксиды азота',
    stops: [
      { t: 0, rgb: [56, 189, 248] },
      { t: 0.3, rgb: [250, 204, 21] },
      { t: 0.55, rgb: [249, 115, 22] },
      { t: 0.8, rgb: [239, 68, 68] },
      { t: 1, rgb: [168, 85, 247] },
    ],
  },
  CO: {
    label: 'CO',
    description: 'Угарный газ',
    stops: [
      { t: 0, rgb: [34, 197, 94] },
      { t: 0.35, rgb: [163, 230, 53] },
      { t: 0.6, rgb: [250, 204, 21] },
      { t: 0.85, rgb: [249, 115, 22] },
      { t: 1, rgb: [239, 68, 68] },
    ],
  },
  'PM2.5': {
    label: 'PM2.5',
    description: 'Мелкодисперсные частицы',
    stops: [
      { t: 0, rgb: [148, 163, 184] },
      { t: 0.3, rgb: [180, 83, 9] },
      { t: 0.55, rgb: [234, 88, 12] },
      { t: 0.8, rgb: [250, 204, 21] },
      { t: 1, rgb: [254, 240, 138] },
    ],
  },
  PM10: {
    label: 'PM10',
    description: 'Взвешенные частицы',
    stops: [
      { t: 0, rgb: [22, 163, 74] },
      { t: 0.3, rgb: [74, 222, 128] },
      { t: 0.55, rgb: [250, 204, 21] },
      { t: 0.8, rgb: [251, 146, 60] },
      { t: 1, rgb: [220, 38, 38] },
    ],
  },
  CO2: {
    label: 'CO2',
    description: 'Углекислый газ',
    stops: [
      { t: 0, rgb: [30, 64, 175] },
      { t: 0.3, rgb: [56, 189, 248] },
      { t: 0.55, rgb: [167, 139, 250] },
      { t: 0.8, rgb: [244, 114, 182] },
      { t: 1, rgb: [251, 113, 133] },
    ],
  },
};

export interface RasterImage {
  width: number;
  height: number;
  /** RGBA, top row is north. */
  pixels: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * Logarithmic scale: concentrations span several orders of magnitude, so a
 * linear ramp would paint everything except the strongest cell as background.
 */
export function normalizeLog(value: number, max: number): number {
  if (!(value > 0) || !(max > 0) || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.log1p(value) / Math.log1p(max));
}

export function sampleRamp(
  stops: readonly RampStop[],
  t: number,
): [number, number, number] {
  if (stops.length === 0) {
    return [255, 255, 255];
  }
  const clamped = Math.min(1, Math.max(0, t));
  for (let i = 1; i < stops.length; i += 1) {
    const previous = stops[i - 1];
    const next = stops[i];
    if (previous && next && clamped <= next.t) {
      const span = next.t - previous.t;
      const local = span > 0 ? (clamped - previous.t) / span : 0;
      return [
        Math.round(previous.rgb[0] + (next.rgb[0] - previous.rgb[0]) * local),
        Math.round(previous.rgb[1] + (next.rgb[1] - previous.rgb[1]) * local),
        Math.round(previous.rgb[2] + (next.rgb[2] - previous.rgb[2]) * local),
      ];
    }
  }
  const last = stops[stops.length - 1];
  return last ? [last.rgb[0], last.rgb[1], last.rgb[2]] : [255, 255, 255];
}

export function emissionColor(
  value: number,
  max: number,
  stops: readonly RampStop[],
): [number, number, number, number] {
  const t = normalizeLog(value, max);
  // Below ~0.1 % of the peak the value is numerically irrelevant; keeping the
  // cells fully transparent avoids a faint veil over the whole grid rectangle.
  if (t <= 0.002) {
    return [0, 0, 0, 0];
  }
  const [r, g, b] = sampleRamp(stops, t);
  const alpha = Math.round(255 * Math.pow(t, 0.85));
  return [r, g, b, alpha];
}

/**
 * Rasterises one pollutant field into an RGBA image. The protocol stores rows
 * south -> north, while an image starts at the north edge, so rows are flipped.
 */
export function rasterizeEmission(
  frame: EmissionGridMessage,
  pollutant: Pollutant,
): RasterImage | null {
  const field = frame.fields[pollutant];
  if (!field || field.data.length !== frame.cols * frame.rows) {
    return null;
  }

  const { cols, rows } = frame;
  const stops = POLLUTANT_INFO[pollutant].stops;
  const pixels = new Uint8ClampedArray(cols * rows * 4);
  const max = field.max > 0 ? field.max : 1;

  for (let row = 0; row < rows; row += 1) {
    const sourceRow = rows - 1 - row;
    for (let col = 0; col < cols; col += 1) {
      const value = field.data[sourceRow * cols + col] ?? 0;
      const [r, g, b, a] = emissionColor(value, max, stops);
      const offset = (row * cols + col) * 4;
      pixels[offset] = r;
      pixels[offset + 1] = g;
      pixels[offset + 2] = b;
      pixels[offset + 3] = a;
    }
  }

  return { width: cols, height: rows, pixels };
}

export function rampCss(stops: readonly RampStop[]): string {
  const parts = stops.map(
    (stop) => `rgb(${stop.rgb[0]}, ${stop.rgb[1]}, ${stop.rgb[2]}) ${stop.t * 100}%`,
  );
  return `linear-gradient(to right, ${parts.join(', ')})`;
}
