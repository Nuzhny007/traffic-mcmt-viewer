import { BitmapLayer } from '@deck.gl/layers';

import { rasterizeEmission, type RasterImage } from '../emissions/palette';
import type { EmissionGridMessage, Pollutant } from '../types/emissions';

function toCanvas(image: RasterImage): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }
  context.putImageData(
    new ImageData(image.pixels, image.width, image.height),
    0,
    0,
  );
  return canvas;
}

/**
 * Rasterising 120×90 cells is cheap, but the overlay rebuilds its layers on
 * every track frame (10 Hz) while the raster only changes at 1 Hz. Keep one
 * canvas per frame and pollutant so deck.gl also sees a stable `image` prop.
 */
const canvasCache = new WeakMap<
  EmissionGridMessage,
  Map<Pollutant, HTMLCanvasElement | null>
>();

function emissionCanvas(
  frame: EmissionGridMessage,
  pollutant: Pollutant,
): HTMLCanvasElement | null {
  let byPollutant = canvasCache.get(frame);
  if (!byPollutant) {
    byPollutant = new Map();
    canvasCache.set(frame, byPollutant);
  }
  if (byPollutant.has(pollutant)) {
    return byPollutant.get(pollutant) ?? null;
  }

  const image = rasterizeEmission(frame, pollutant);
  const canvas = image ? toCanvas(image) : null;
  byPollutant.set(pollutant, canvas);
  return canvas;
}

/**
 * Raster overlay for the concentration grid. `bounds` is
 * `[west, south, east, north]`, matching the protocol frame.
 */
export function createEmissionLayer(
  frame: EmissionGridMessage | null,
  pollutant: Pollutant,
  visible: boolean,
  opacity: number,
): BitmapLayer | null {
  if (!visible || !frame) {
    return null;
  }
  const canvas = emissionCanvas(frame, pollutant);
  if (!canvas) {
    return null;
  }

  const { west, south, east, north } = frame.bounds;
  return new BitmapLayer({
    id: 'emission-grid',
    image: canvas,
    bounds: [west, south, east, north],
    opacity,
    pickable: false,
  });
}
