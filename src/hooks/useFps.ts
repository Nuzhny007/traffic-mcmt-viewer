import { useEffect, useState } from 'react';

/** Rough FPS meter for the performance budget (stage 4 uses a proper one). */
export function useFps(): number {
  const [fps, setFps] = useState(0);

  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      frames += 1;
      const elapsed = now - last;
      if (elapsed >= 1000) {
        setFps(Math.round((frames * 1000) / elapsed));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return fps;
}
