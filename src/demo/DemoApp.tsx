import { useEffect, useRef, useState } from 'react';

import { EmissionPanel } from '../components/EmissionPanel';
import { MapView } from '../components/MapView';
import { TrackDetails } from '../components/TrackDetails';
import { appConfig } from '../config';
import { setDemoClockActive } from './demoClock';
import { DEMO_STAGE_LABEL, useDemoStore } from './demoStore';
import { DEMO_TOTAL_MS, startDirector } from './director';
import { EmissionTotalsPanel } from './EmissionTotalsPanel';
import { VideoPanel } from './VideoPanel';
import { useFps } from '../hooks/useFps';
import { useSelectedTrack } from '../hooks/useSelectedTrack';
import { startFeed, stopFeed, trackBuffer } from '../net/feed';
import { useTrackingStore } from '../store/trackingStore';
import type { ConnectionStatus } from '../types/tracking';

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  idle: 'ожидание',
  connecting: 'подключение',
  open: 'online',
  closed: 'offline',
};

/** 250 ms ticker driving the stage progress bar without React state. */
function StageBar() {
  const stage = useDemoStore((state) => state.stage);
  const startedAt = useDemoStore((state) => state.startedAt);
  const barRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const update = () => {
      const bar = barRef.current;
      if (!bar || startedAt === null) {
        return;
      }
      const progress = Math.min(1, (performance.now() - startedAt) / DEMO_TOTAL_MS);
      bar.style.width = `${(progress * 100).toFixed(1)}%`;
    };
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [startedAt]);

  return (
    <div className="demo-stage">
      <span className="demo-stage-label">{DEMO_STAGE_LABEL[stage]}</span>
      <span className="demo-stage-track">
        <span className="demo-stage-fill" ref={barRef} />
      </span>
    </div>
  );
}

/**
 * Demo layout: camera video with a CarsCounting-style overlay on the left,
 * the live map (tracks + emission layer) on the right, cumulative emission
 * totals under the video. Rendered for `?demo=1`.
 */
export function DemoApp() {
  const fps = useFps();
  const trackCount = useTrackingStore((state) => state.trackCount);
  const messageRate = useTrackingStore((state) => state.messageRate);
  const connection = useTrackingStore((state) => state.connection);
  const zones = useTrackingStore((state) => state.zones);
  const selectedId = useTrackingStore((state) => state.selectedId);
  const select = useTrackingStore((state) => state.select);
  const phase = useDemoStore((state) => state.phase);

  const selected = useSelectedTrack(selectedId);
  const [directorReady, setDirectorReady] = useState(false);

  useEffect(() => {
    setDemoClockActive(true);
    startFeed();
    return () => {
      setDemoClockActive(false);
      stopFeed();
    };
  }, []);

  // The scenario starts as soon as the replay delivers its first tracks; the
  // video player aligns itself to the data time from that moment.
  //
  // The recorder can take control of the timing: with `window.__demoWait` set
  // before page load, the page reports `window.__demoArmed` once data has
  // arrived and starts the director only after the recorder flips
  // `window.__demoGo` — so the screencast captures the scenario from the very
  // first frame instead of joining it ~10 s late.
  useEffect(() => {
    if (phase !== 'idle' || directorReady) {
      return;
    }
    const waitForRecorder = window.__demoWait === true;
    let armed = false;
    const timer = setInterval(() => {
      if (!armed) {
        if (trackBuffer.size <= 0) {
          return;
        }
        if (waitForRecorder) {
          armed = true;
          window.__demoArmed = true;
          return;
        }
        clearInterval(timer);
        startDirector();
        setDirectorReady(true);
        return;
      }
      if (window.__demoGo === true) {
        clearInterval(timer);
        startDirector();
        setDirectorReady(true);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [phase, directorReady]);

  const handleSelect = (id: number | null) => select(id);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          TrafficMCMT <span>Viewer</span>
        </div>
        <span className="badge">демо · мониторинг воздуха с дорожной камеры</span>
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
        <div className={`status status-${connection}`}>
          <i /> {STATUS_LABEL[connection]}
        </div>
      </header>

      <main className="demo-main">
        <section className="demo-left">
          <div className="demo-video-block">
            <StageBar />
            <VideoPanel enabled={directorReady} />
            <div className="demo-caption">
              Камера <b>cam-01</b> · Aire, FR · трекинг MCMT + обратная
              проекция треков на кадр
            </div>
          </div>
          <EmissionTotalsPanel />
        </section>

        <section className="demo-right">
          <div className="map-wrap">
            <MapView selectedId={selectedId} onSelect={handleSelect} />
            <EmissionPanel />
            <div className="hud-column">
              {selected && (
                <TrackDetails track={selected} hiddenByFilter={false} onClear={() => select(null)} />
              )}
            </div>
            {connection !== 'open' && (
              <div className="hud hud-connection">
                <div className="hud-title">WebSocket</div>
                <div className="hud-url">{appConfig.wsUrl}</div>
                <div className="hud-muted">
                  {connection === 'connecting' ? 'Подключение…' : 'Ожидание потока…'}
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="app-footer">
        <span>deck.gl 9 · MapLibre GL JS · React 18</span>
        <span>
          WS-поток 10 Гц · Gaussian puff (HBEFA) · концентрации и суммарные
          выбросы в реальном времени
        </span>
      </footer>
    </div>
  );
}
