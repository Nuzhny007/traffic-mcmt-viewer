import { useEffect, useMemo, useRef, useState } from 'react';

import { EmissionPanel } from '../components/EmissionPanel';
import { MapView } from '../components/MapView';
import { TrackDetails } from '../components/TrackDetails';
import { appConfig } from '../config';
import { setDemoClockActive } from './demoClock';
import { demoSceneFromSearch } from './demoData';
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
 * Demo layout rendered for `?demo=<scene>`. The Aire scene (`?demo=1`) shows one
 * camera over the map; the Auburn scene (`?demo=auburn`) shows two synchronised
 * cameras of the same intersection above the map. Both cameras of a scene share
 * the ENU origin and export time base, so the map and the two videos stay in
 * step.
 */
export function DemoApp() {
  const scene = useMemo(() => demoSceneFromSearch(window.location.search), []);
  const cameraCount = scene.cameras.length;
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
    setDemoClockActive(true, scene.epochMs);
    startFeed();
    return () => {
      setDemoClockActive(false);
      stopFeed();
    };
  }, [scene.epochMs]);

  // The scenario starts as soon as the replay delivers its first tracks; the
  // video players align themselves to the data time from that moment.
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

  const header = (
    <header className="app-header">
      <div className="brand">
        TrafficMCMT <span>Viewer</span>
      </div>
      <span className="badge">
        {cameraCount > 1
          ? 'демо · две синхронные камеры · мониторинг воздуха'
          : 'демо · мониторинг воздуха с дорожной камеры'}
      </span>
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
  );

  const footer = (
    <footer className="app-footer">
      <span>deck.gl 9 · MapLibre GL JS · React 18</span>
      <span>
        WS-поток 10 Гц · Gaussian puff (HBEFA) · концентрации и суммарные
        выбросы в реальном времени
      </span>
    </footer>
  );

  const connectionHud = connection !== 'open' && (
    <div className="hud hud-connection">
      <div className="hud-title">WebSocket</div>
      <div className="hud-url">{appConfig.wsUrl}</div>
      <div className="hud-muted">
        {connection === 'connecting' ? 'Подключение…' : 'Ожидание потока…'}
      </div>
    </div>
  );

  if (cameraCount > 1) {
    return (
      <div className="app">
        {header}
        <main className="demo-main demo-main-dual">
          <StageBar />
          <section className="demo-dual-videos">
            {scene.cameras.map((camera) => (
              <div className="demo-video-block" key={camera.label}>
                <VideoPanel camera={camera} enabled={directorReady} />
                <div className="demo-caption">{camera.caption}</div>
              </div>
            ))}
          </section>
          <section className="demo-dual-bottom">
            <div className="map-wrap demo-map">
              <MapView selectedId={selectedId} onSelect={handleSelect} />
              <EmissionPanel />
              <div className="hud-column">
                {selected && (
                  <TrackDetails
                    track={selected}
                    hiddenByFilter={false}
                    onClear={() => select(null)}
                  />
                )}
              </div>
              {connectionHud}
            </div>
            <aside className="demo-side">
              <EmissionTotalsPanel />
            </aside>
          </section>
        </main>
        {footer}
      </div>
    );
  }

  return (
    <div className="app">
      {header}

      <main className="demo-main">
        <section className="demo-left">
          <div className="demo-video-block">
            <StageBar />
            <VideoPanel camera={scene.cameras[0]} enabled={directorReady} />
            <div className="demo-caption">{scene.cameras[0].caption}</div>
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
            {connectionHud}
          </div>
        </section>
      </main>

      {footer}
    </div>
  );
}
