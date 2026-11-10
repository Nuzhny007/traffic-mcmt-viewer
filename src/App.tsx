import { useCallback, useEffect } from 'react';

import { EmissionPanel } from './components/EmissionPanel';
import { MapView } from './components/MapView';
import { appConfig } from './config';
import { nowMs } from './domain/clock';
import {
  CLASS_COLORS,
  classColor,
  classLabel,
} from './domain/classes';
import { useFps } from './hooks/useFps';
import { useSelectedTrack } from './hooks/useSelectedTrack';
import { startFeed, stopFeed } from './net/feed';
import { useTrackingStore } from './store/trackingStore';
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

export function App() {
  const fps = useFps();
  const selectedId = useTrackingStore((state) => state.selectedId);
  const select = useTrackingStore((state) => state.select);
  const connection = useTrackingStore((state) => state.connection);
  const reconnectAttempt = useTrackingStore((state) => state.reconnectAttempt);
  const zones = useTrackingStore((state) => state.zones);
  const trackCount = useTrackingStore((state) => state.trackCount);
  const messageRate = useTrackingStore((state) => state.messageRate);

  const selected = useSelectedTrack(selectedId);

  useEffect(() => {
    startFeed();
    return () => stopFeed();
  }, []);

  const handleSelect = useCallback(
    (id: number | null) => select(id),
    [select],
  );

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
        <span className="badge">этап 2c · выбросы</span>

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
          ЛКМ — выбрать трек · колесо — зум · ЛКМ+перетаскивание — пан
        </div>

        <EmissionPanel />

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

        <div className="hud hud-legend">
          <div className="hud-title">Классы объектов</div>
          <ul className="legend">
            {Object.entries(CLASS_COLORS).map(([className, color]) => (
              <li key={className}>
                <span
                  className="legend-dot"
                  style={{ backgroundColor: `rgb(${color[0]}, ${color[1]}, ${color[2]})` }}
                />
                {classLabel(className)}
              </li>
            ))}
          </ul>
        </div>

        {selected && (
          <aside className="hud hud-details">
            <div className="hud-title">Трек #{selected.id}</div>
            <dl>
              <dt>Класс</dt>
              <dd>
                <span
                  className="legend-dot"
                  style={{
                    backgroundColor: `rgb(${classColor(selected.className)
                      .slice(0, 3)
                      .join(', ')})`,
                  }}
                />
                {classLabel(selected.className)}
              </dd>
              <dt>Камера</dt>
              <dd>CAM {selected.cameraId}</dd>
              <dt>Позиция</dt>
              <dd>
                {selected.position[1].toFixed(5)}, {selected.position[0].toFixed(5)}
              </dd>
              <dt>Скорость</dt>
              <dd>
                {selected.speedKmh.toFixed(1)} км/ч
              </dd>
              <dt>Точек в хвосте</dt>
              <dd>{selected.trail.length}</dd>
              <dt>Обновлён</dt>
              <dd>{((nowMs() - selected.lastSeen) / 1000).toFixed(1)} с назад</dd>
            </dl>
            <button type="button" onClick={() => select(null)}>
              Сбросить выбор
            </button>
          </aside>
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
