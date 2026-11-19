import { useEffect, useRef, useState } from 'react';

import { useEmissionStore } from '../store/emissionStore';
import { POLLUTANTS, type Pollutant } from '../types/emissions';
import { POLLUTANT_INFO } from '../emissions/palette';

function formatGrams(value: number): string {
  if (value >= 100_000) {
    return `${(value / 1000).toFixed(1)} кг`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} кг`;
  }
  if (value >= 100) {
    return value.toFixed(0);
  }
  if (value >= 10) {
    return value.toFixed(1);
  }
  return value.toFixed(2);
}

function formatRate(value: number | null): string {
  if (value === null) {
    return '—';
  }
  if (value >= 100) {
    return value.toFixed(0);
  }
  if (value >= 10) {
    return value.toFixed(1);
  }
  return value.toFixed(2);
}

interface TotalsRowProps {
  pollutant: Pollutant;
  total: number;
  rate: number | null;
  /** Log-scaled bar width, 0..1, relative to the largest total. */
  bar: number;
}

function TotalsRow({ pollutant, total, rate, bar }: TotalsRowProps) {
  const info = POLLUTANT_INFO[pollutant];
  return (
    <div className="totals-row">
      <span className="totals-name" title={info.description}>
        {info.label}
      </span>
      <span className="totals-bar">
        <i style={{ width: `${Math.max(2, Math.round(bar * 100))}%` }} />
      </span>
      <span className="totals-value">{formatGrams(total)} г</span>
      <span className="totals-rate">+{formatRate(rate)} г/с</span>
    </div>
  );
}

/**
 * Cumulative emissions per pollutant, straight from the additive
 * `totals_g` field of `emission_grid` (HBEFA mass, grams). The g/s rate is
 * derived client-side from consecutive 1 Hz frames. Updates once per second.
 */
export function EmissionTotalsPanel() {
  const totals = useEmissionStore((state) => state.totals);
  const available = useEmissionStore((state) => state.available);

  const previous = useRef<{ totals: Partial<Record<Pollutant, number>>; at: number } | null>(null);
  const [rates, setRates] = useState<Partial<Record<Pollutant, number>>>({});

  useEffect(() => {
    const now = performance.now();
    const prev = previous.current;
    if (prev) {
      const dt = (now - prev.at) / 1000;
      if (dt > 0.2) {
        const next: Partial<Record<Pollutant, number>> = {};
        for (const pollutant of POLLUTANTS) {
          const before = prev.totals[pollutant];
          const after = totals[pollutant];
          if (before !== undefined && after !== undefined && after >= before) {
            next[pollutant] = (after - before) / dt;
          }
        }
        setRates(next);
      }
    }
    previous.current = { totals, at: now };
  }, [totals]);

  if (!available) {
    return null;
  }

  const maxTotal = Math.max(
    ...POLLUTANTS.map((pollutant) => totals[pollutant] ?? 0),
    1e-6,
  );
  // CO2 dwarfs the g-scale pollutants, so the bars use a log scale.
  const logMax = Math.log10(1 + maxTotal);

  const grand = POLLUTANTS.reduce((sum, pollutant) => sum + (totals[pollutant] ?? 0), 0);

  return (
    <aside className="hud hud-totals">
      <div className="hud-title">Выбросы · HBEFA, накоплено с начала потока</div>
      <div className="totals-rows">
        {POLLUTANTS.map((pollutant) => {
          const total = totals[pollutant] ?? 0;
          const bar = logMax > 0 ? Math.log10(1 + total) / logMax : 0;
          return (
            <TotalsRow
              key={pollutant}
              pollutant={pollutant}
              total={total}
              rate={rates[pollutant] ?? null}
              bar={bar}
            />
          );
        })}
      </div>
      <div className="totals-grand">
        Всего выброшено: <b>{formatGrams(grand)} г</b>
      </div>
    </aside>
  );
}
