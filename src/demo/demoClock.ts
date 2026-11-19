import { nowMs } from '../domain/clock';
import { DEMO_EPOCH_MS } from './demoData';

/**
 * Bridge between the WS feed and the demo video player.
 *
 * The gateway paces the replay by protocol timestamps, so the video position
 * that matches the data on screen is `(protocol timestamp - epoch) / 1000`.
 * The feed reports every tracks_update timestamp here; the video overlay polls
 * `expectedVideoTime()` from its animation loop and gently re-aligns playback.
 */
let active = false;
let lastProtocolTs = 0;
let lastReceivedAt = 0;

export function setDemoClockActive(value: boolean): void {
  active = value;
  if (!value) {
    lastProtocolTs = 0;
    lastReceivedAt = 0;
  }
}

/** Called by the feed for every `tracks_update`; cheap no-op outside demo. */
export function noteTrackTimestamp(protocolTimestampMs: number): void {
  if (!active || !Number.isFinite(protocolTimestampMs)) {
    return;
  }
  if (protocolTimestampMs < lastProtocolTs) {
    return;
  }
  lastProtocolTs = protocolTimestampMs;
  lastReceivedAt = nowMs();
}

/**
 * Video position (seconds) matching the data on screen right now, or `null`
 * while no track timestamps have been observed yet.
 */
export function expectedVideoTime(): number | null {
  if (!active || lastProtocolTs === 0 || lastReceivedAt === 0) {
    return null;
  }
  const dataSeconds = (lastProtocolTs - DEMO_EPOCH_MS) / 1000;
  const staleSeconds = (nowMs() - lastReceivedAt) / 1000;
  return dataSeconds + staleSeconds;
}
