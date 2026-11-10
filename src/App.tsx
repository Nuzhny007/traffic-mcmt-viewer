import { useCallback, useEffect } from 'react';

import { ControlPanel } from './components/ControlPanel';
import { EmissionPanel } from './components/EmissionPanel';
import { MapView } from './components/MapView';
import { TrackDetails } from './components/TrackDetails';
import { appConfig } from './config';
import { ALL_CLASSES } from './domain/classes';
import { matchesFilter } from './domain/filter';
import { useFps } from './hooks/useFps';
import { useSelectedTrack } from './hooks/useSelectedTrack';
import { startFeed, stopFeed } from './net/feed';
import { useTrackingStore } from './store/trackingStore';
import { startViewSync, useViewStore } from './store/viewStore';
import type { ConnectionStatus } from './types/tracking';

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  idle: 'ожидание',
  connecting: 'подключение',
  open: 'online',
  closed: 'offline',
};

const STATUS_CLASS: Record<ConnectionStatus, string> = {
  idle: 'status-idle',
  connecting: 'status-connecting',
  open: 'status-online',
  closed: 'status-offline',
};

/** Digits 1–6 toggle classes; H/Z toggle layers; Esc clears the selection. */
function useViewShortcuts(clearSelection: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        if (event.key === 'Escape') {
          target.blur();
        }
        return;
      }

      if (/^[1-9]$/.test(event.key)) {
        const className = ALL_CLASSES[Number(event.key) - 1];
        if (className) {
          const view = useViewStore.getState();
          if (event.shiftKey) {
            view.onlyClass(className);
          } else {
            view.toggleClass(className);
          }
        }
        return;
      }

      const view = useViewStore.getState();
      switch (event.key.toLowerCase()) {
        case 'h':
          view.setShowTrails(!view.showTrails);
          break;
        case 'z':
          view.setShowZones(!view.showZones);
          break;
        case 'escape':
          view.setQuery('');
          clearSelection();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clearSelection]);
}

export function App() {
  const fps = useFps();
  const selectedId = useTrackingStore((state) => state.selectedId);
  const select = useTrackingStore((state) => state.select);
  const connection = useTrackingStore((state) => state.connection);
  const reconnectAttempt = useTrackingStore((state) => state.reconnectAttempt);
  const zones = useTrackingStore((state) => state.zones);
  const trackCount = useTrackingStore((state) => state.trackCount);
  const messageRate = useTrackingStore((state) => state.messageRate);
  const view = useViewStore();

  const selected = useSelectedTrack(selectedId);
  const hiddenByFilter = selected !== null && !matchesFilter(selected, view);

  useEffect(() => {
    startFeed();
    const stopViewSync = startViewSync();
    return () => {
      stopViewSync();
      stopFeed();
    };
  }, []);

  const handleSelect = useCallback(
    (id: number | null) => select(id),
    [select],
  );
  const clearSelection = useCallback(() => select(null), [select]);

  useViewShortcuts(clearSelection);

  const statusText =
    connection === 'closed' && reconnectAttempt > 0
      ? `${STATUS_LABEL[connection]} · ${reconnectAttempt}`
      : STATUS_LABEL[connection];

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          TrafficMCMT <span>Viewer</span>
        </div>
        <span className="badge">этап 5 · фильтры и слои</span>

        <div className="spacer" />

        <div className="metric">
          FPS <b>{fps}</b>
        </div>
        <div className="metric">
          Треков <b>{trackCount}</b>
        </div>
        <div className="metric">
          Сообщ/с <b>{messageRate}</b>
        </div>
        <div className="metric">
          Камер <b>{zones.size}</b>
        </div>
        <div
          className={`status ${STATUS_CLASS[connection]}`}
          title={appConfig.wsUrl}
        >
          <i /> {statusText}
        </div>
      </header>

      <main className="map-wrap">
        <MapView selectedId={selectedId} onSelect={handleSelect} />

        <div className="hud hud-hint">
          ЛКМ — выбрать трек · 1–6 — классы · H/Z — слои · Esc — сброс
        </div>

        <EmissionPanel />

        <div className="hud-column">
          <ControlPanel />
          {selected && (
            <TrackDetails
              track={selected}
              hiddenByFilter={hiddenByFilter}
              onClear={clearSelection}
            />
          )}
        </div>

        {connection !== 'open' && (
          <div className="hud hud-connection">
            <div className="hud-title">WebSocket</div>
            <div className="hud-url">{appConfig.wsUrl}</div>
            <div className="hud-muted">
              {connection === 'connecting'
                ? 'Подключение…'
                : connection === 'closed'
                  ? `Переподключение (попытка ${reconnectAttempt})…`
                  : 'Соединение не запущено'}
            </div>
            <div className="hud-muted">
              Backend: <code>trafficmcmt_map_gateway</code>
            </div>
            <div className="hud-muted">
              или mock: <code>npm run mock</code>
            </div>
          </div>
        )}
      </main>

      <footer className="app-footer">
        <span>deck.gl 9 · MapLibre GL JS · React 18</span>
        <span>
          WS-поток 10 Гц · TTL {appConfig.trackTtlMs / 1000} с · Gaussian puff
          (HBEFA)
        </span>
      </footer>
    </div>
  );
}
