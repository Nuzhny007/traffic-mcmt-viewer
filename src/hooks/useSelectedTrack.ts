import { useEffect, useState } from 'react';

import { trackBuffer } from '../net/feed';
import type { LiveTrack } from '../net/trackBuffer';

const REFRESH_MS = 250;

/**
 * Reads the selected track from the mutable buffer at a low refresh rate.
 * This is the only place where live data drives a React render; the map itself
 * is updated imperatively.
 */
export function useSelectedTrack(id: number | null): LiveTrack | null {
  const [track, setTrack] = useState<LiveTrack | null>(null);

  useEffect(() => {
    if (id === null) {
      setTrack(null);
      return;
    }

    const read = () => setTrack(trackBuffer.get(id) ?? null);
    read();
    const timer = setInterval(read, REFRESH_MS);
    return () => clearInterval(timer);
  }, [id]);

  return track;
}
