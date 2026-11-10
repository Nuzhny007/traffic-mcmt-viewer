import { appConfig } from '../config';
import { nowMs } from '../domain/clock';
import { useEmissionStore } from '../store/emissionStore';
import { useTrackingStore } from '../store/trackingStore';
import type { CameraZone, ServerMessage } from '../types/tracking';
import { emissionBuffer } from './emissionBuffer';
import { TrackBuffer } from './trackBuffer';
import { TrackingSocket } from './wsClient';

/** High-frequency track data shared with the deck.gl overlay. */
export const trackBuffer = new TrackBuffer();

let socket: TrackingSocket | null = null;
let statsTimer: ReturnType<typeof setInterval> | null = null;
let messagesInWindow = 0;
let windowStartedAt = 0;
let lastMessageAt = 0;
let zonesSignature = '';

function applyZones(zones: CameraZone[]): void {
  // A backend may repeat the same zones in every update; avoid React renders
  // (and deck layer rebuilds) when nothing actually changed.
  const signature = JSON.stringify(zones);
  if (signature === zonesSignature) {
    return;
  }
  zonesSignature = signature;
  useTrackingStore.getState().setZones(zones);
}

function handleMessage(message: ServerMessage): void {
  const receivedAt = nowMs();

  messagesInWindow += 1;
  lastMessageAt = receivedAt;

  switch (message.type) {
    case 'tracks_update':
      trackBuffer.apply(
        message.tracks,
        message.mode ?? 'delta',
        receivedAt,
      );
      if (message.camera_zones) {
        applyZones(message.camera_zones);
      }
      break;
    case 'camera_zones':
      applyZones(message.camera_zones);
      break;
    case 'id_merge':
      trackBuffer.mergeIds(message.old_id, message.new_id);
      if (useTrackingStore.getState().selectedId === message.old_id) {
        useTrackingStore.getState().select(message.new_id);
      }
      break;
    case 'tracks_remove': {
      trackBuffer.remove(message.ids);
      const selectedId = useTrackingStore.getState().selectedId;
      if (selectedId !== null && message.ids.includes(selectedId)) {
        useTrackingStore.getState().select(null);
      }
      break;
    }
    case 'heartbeat':
      break;
    case 'emission_grid':
      emissionBuffer.apply(message);
      useEmissionStore.getState().setFrameMeta(message);
      break;
  }
}

function pushStats(): void {
  const now = nowMs();
  trackBuffer.prune(appConfig.trackTtlMs, now);

  const elapsed = Math.max(1, now - windowStartedAt);
  const messageRate = Math.round((messagesInWindow * 1000) / elapsed);
  messagesInWindow = 0;
  windowStartedAt = now;

  // Per-class/camera totals feed the filter chips. One pass per second over the
  // buffer is cheap even at a few thousand tracks and keeps React out of the
  // 10 Hz path.
  const classCounts: Record<string, number> = {};
  const cameraCounts: Record<number, number> = {};
  for (const track of trackBuffer.list()) {
    classCounts[track.className] = (classCounts[track.className] ?? 0) + 1;
    cameraCounts[track.cameraId] = (cameraCounts[track.cameraId] ?? 0) + 1;
  }

  useTrackingStore.getState().setStats({
    trackCount: trackBuffer.size,
    messageRate,
    lastMessageAt: lastMessageAt || null,
    classCounts,
    cameraCounts,
  });
}

export function startFeed(): void {
  if (socket) {
    return;
  }

  const store = useTrackingStore.getState();
  store.reset();
  emissionBuffer.clear();
  useEmissionStore.getState().reset();

  socket = new TrackingSocket({
    url: appConfig.wsUrl,
    heartbeatTimeoutMs: appConfig.wsTimeoutMs,
    handlers: {
      onMessage: handleMessage,
      onStatus: (status, attempt) => {
        useTrackingStore.getState().setConnection(status, attempt);
      },
    },
  });

  windowStartedAt = nowMs();
  lastMessageAt = 0;
  messagesInWindow = 0;
  zonesSignature = '';
  socket.start();

  statsTimer = setInterval(pushStats, 1_000);
}

export function stopFeed(): void {
  socket?.stop();
  socket = null;

  if (statsTimer !== null) {
    clearInterval(statsTimer);
    statsTimer = null;
  }

  trackBuffer.clear();
  emissionBuffer.clear();
  zonesSignature = '';
  useEmissionStore.getState().reset();
  useTrackingStore.getState().reset();
}
