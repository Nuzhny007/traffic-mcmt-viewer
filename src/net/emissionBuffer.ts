import type { EmissionGridMessage } from '../types/emissions';

/**
 * Latest concentration frame, shared with the deck.gl overlay.
 *
 * Like `TrackBuffer`, this is deliberately a mutable singleton: the raster is
 * replaced at 1 Hz and the overlay reads it from its animation loop, so React
 * does not need to re-render or diff 50k floats per frame.
 */
export class EmissionBuffer {
  private current: EmissionGridMessage | null = null;
  private currentVersion = 0;

  get frame(): EmissionGridMessage | null {
    return this.current;
  }

  get version(): number {
    return this.currentVersion;
  }

  apply(frame: EmissionGridMessage): void {
    this.current = frame;
    this.currentVersion += 1;
  }

  clear(): void {
    this.current = null;
    this.currentVersion += 1;
  }
}

export const emissionBuffer = new EmissionBuffer();
