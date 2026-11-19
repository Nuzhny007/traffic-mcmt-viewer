import { nowMs } from '../domain/clock';

/**
 * Bridge between the WS feed and the demo video players.
 *
 * The gateway paces the replay by protocol timestamps, so the video position
 * that matches the data on screen is `(protocol timestamp - epoch) / 1000`.
 * The feed reports every tracks_update timestamp here; each video overlay polls
 * `expectedVideoTime()` from its animation loop and gently re-aligns playback.
 * Every camera of a scene shares the epoch, so two synchronised clips stay in
 * step with each other.
 */
let active = false;
let epochMs = 0;
let lastProtocolTs = 0;
let lastReceivedAt = 0;

export function setDemoClockActive(value: boolean, epoch = 0): void {
  active = value;
  epochMs = epoch;
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
  const dataSeconds = (lastProtocolTs - epochMs) / 1000;
  const staleSeconds = (nowMs() - lastReceivedAt) / 1000;
  return dataSeconds + staleSeconds;
}
