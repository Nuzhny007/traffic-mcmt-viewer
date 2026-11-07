import type { RGBA } from '../types/tracking';

export type TrackClass = 'car' | 'truck' | 'bus' | 'person' | 'bike' | 'unknown';

export const CLASS_COLORS: Record<TrackClass, RGBA> = {
  car: [56, 189, 248, 235],
  truck: [251, 146, 60, 235],
  bus: [250, 204, 21, 235],
  person: [244, 114, 182, 235],
  bike: [74, 222, 128, 235],
  unknown: [148, 163, 184, 235],
};

export const CLASS_LABELS: Record<TrackClass, string> = {
  car: 'Авто',
  truck: 'Грузовик',
  bus: 'Автобус',
  person: 'Пешеход',
  bike: 'Велосипед',
  unknown: 'Другое',
};

export function classColor(className: string): RGBA {
  return CLASS_COLORS[className as TrackClass] ?? CLASS_COLORS.unknown;
}

export function classLabel(className: string): string {
  return CLASS_LABELS[className as TrackClass] ?? className;
}
