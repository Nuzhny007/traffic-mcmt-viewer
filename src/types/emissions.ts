/** Protocol types for the additive `emission_grid` frame (v1). */

export const POLLUTANTS = ['NOx', 'CO', 'PM2.5', 'PM10', 'CO2'] as const;

export type Pollutant = (typeof POLLUTANTS)[number];

export interface EmissionBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface EmissionField {
  /** Row-major, south -> north, in ug/m3. */
  data: Float32Array;
  max: number;
  mean: number;
  p95: number;
}

export interface EmissionStats {
  max: number;
  mean: number;
  p95: number;
}

export interface EmissionGridMessage {
  type: 'emission_grid';
  /** Unix time in milliseconds. */
  timestamp: number;
  unit: string;
  bounds: EmissionBounds;
  cols: number;
  rows: number;
  fields: Partial<Record<Pollutant, EmissionField>>;
}

export function isPollutant(value: string): value is Pollutant {
  return (POLLUTANTS as readonly string[]).includes(value);
}
