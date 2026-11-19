import { emissionBuffer } from '../net/emissionBuffer';
import { trackBuffer } from '../net/feed';
import { useEmissionStore } from '../store/emissionStore';
import { useTrackingStore } from '../store/trackingStore';
import { DEMO_STAGE_LABEL, useDemoStore, type DemoStage } from './demoStore';

/**
 * Demo timeline (ms since start). Stage 1 shows only objects and tracks, then
 * the emission layer switches pollutant while the tracks stay on the map.
 */
const STAGES: ReadonlyArray<{ at: number; stage: DemoStage }> = [
  { at: 0, stage: 'tracks' },
  { at: 35_000, stage: 'nox' },
  { at: 75_000, stage: 'pm25' },
  { at: 115_000, stage: 'final' },
];

/** Total scenario length; after this the recorder is told to stop. */
export const DEMO_TOTAL_MS = 125_000;

declare global {
  interface Window {
    /**
     * Recorder handshake, installed via `Page.addScriptToEvaluateOnNewDocument`
     * before the page loads: do not autostart the scenario, arm instead and
     * wait for `__demoGo`.
     */
    __demoWait?: boolean;
    /** Recorder handshake: data has arrived, the page waits for `__demoGo`. */
    __demoArmed?: boolean;
    /** Recorder handshake: set by the recorder to start the armed scenario. */
    __demoGo?: boolean;
    /** Recorder: the scenario is running (`startDirector()` has been called). */
    __demoReady?: boolean;
    /** Recorder: the scenario has finished. */
    __demoDone?: boolean;
  }
}

export function startDirector(): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const { setPhase, setStage, setStartedAt } = useDemoStore.getState();

  const applyStage = (stage: DemoStage): void => {
    setStage(stage);
    const emissions = useEmissionStore.getState();
    if (stage === 'tracks') {
      emissions.setVisible(false);
      emissions.setPollutant('NOx');
    } else if (stage === 'nox') {
      emissions.setPollutant('NOx');
      emissions.setVisible(true);
    } else if (stage === 'pm25') {
      emissions.setPollutant('PM2.5');
      emissions.setVisible(true);
    } else {
      // Final: keep the field on, highlight the longest-lived track so the
      // details card is visible in the recording.
      emissions.setVisible(true);
      let best: { id: number; points: number } | null = null;
      for (const track of trackBuffer.list()) {
        if (!best || track.trail.length > best.points) {
          best = { id: track.id, points: track.trail.length };
        }
      }
      if (best) {
        useTrackingStore.getState().select(best.id);
      }
    }
  };

  // The raster buffer may already hold a frame from the connection snapshot:
  // stage 1 must start with the layer off.
  emissionBuffer.clear();
  applyStage('tracks');
  setStartedAt(performance.now());
  setPhase('running');
  window.__demoReady = true;
  window.__demoArmed = false;

  for (const { at, stage } of STAGES) {
    if (at === 0) {
      continue;
    }
    timers.push(
      setTimeout(() => applyStage(stage), at),
    );
  }

  timers.push(
    setTimeout(() => {
      setPhase('done');
      window.__demoDone = true;
    }, DEMO_TOTAL_MS),
  );

  return () => {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    window.__demoReady = false;
    window.__demoArmed = false;
    window.__demoDone = false;
  };
}

export { DEMO_STAGE_LABEL };
