import { create } from 'zustand';

/** Demo scenario stages, driven by the director timeline. */
export type DemoStage = 'tracks' | 'nox' | 'pm25' | 'final';

interface DemoState {
  /** idle → running (director started) → done (scenario finished). */
  phase: 'idle' | 'running' | 'done';
  stage: DemoStage;
  /** Wall-clock time the director started, for the stage progress bar. */
  startedAt: number | null;
  setPhase: (phase: DemoState['phase']) => void;
  setStage: (stage: DemoStage) => void;
  setStartedAt: (at: number) => void;
}

export const useDemoStore = create<DemoState>((set) => ({
  phase: 'idle',
  stage: 'tracks',
  startedAt: null,
  setPhase: (phase) => set({ phase }),
  setStage: (stage) => set({ stage }),
  setStartedAt: (startedAt) => set({ startedAt }),
}));

export const DEMO_STAGE_LABEL: Record<DemoStage, string> = {
  tracks: 'Этап 1 · Обнаружение и трекинг объектов',
  nox: 'Этап 2 · Концентрации NOx над дорогой',
  pm25: 'Этап 3 · Концентрации PM2.5',
  final: 'Этап 4 · Суммарные выбросы по типам',
};
