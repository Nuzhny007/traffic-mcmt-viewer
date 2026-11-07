import { POLLUTANT_INFO, rampCss } from '../emissions/palette';
import { useEmissionStore } from '../store/emissionStore';
import { POLLUTANTS } from '../types/emissions';

function formatConcentration(value: number): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  if (value >= 100_000) {
    return `${(value / 1000).toFixed(0)}k`;
  }
  if (value >= 10_000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  if (value >= 1000) {
    return `${Math.round(value)}`;
  }
  if (value >= 10) {
    return value.toFixed(0);
  }
  if (value >= 1) {
    return value.toFixed(1);
  }
  return value.toFixed(2);
}

export function EmissionPanel() {
  const available = useEmissionStore((state) => state.available);
  const visible = useEmissionStore((state) => state.visible);
  const pollutant = useEmissionStore((state) => state.pollutant);
  const stats = useEmissionStore((state) => state.stats);
  const timestamp = useEmissionStore((state) => state.timestamp);
  const cols = useEmissionStore((state) => state.cols);
  const rows = useEmissionStore((state) => state.rows);
  const setVisible = useEmissionStore((state) => state.setVisible);
  const setPollutant = useEmissionStore((state) => state.setPollutant);

  if (!available) {
    return null;
  }

  const info = POLLUTANT_INFO[pollutant];
  const current = stats[pollutant];
  // Replay datasets carry their original 2021 timestamps, so a wall-clock age
  // would be meaningless there. Show the frame time instead.
  const ageMs = timestamp !== null ? Date.now() - timestamp : null;
  const isLive = ageMs !== null && ageMs >= -5000 && ageMs < 3_600_000;
  const ageSeconds =
    isLive && ageMs !== null ? Math.max(0, Math.round(ageMs / 1000)) : null;
  const frameTime =
    timestamp !== null
      ? new Date(timestamp).toLocaleTimeString('ru-RU', { hour12: false })
      : null;

  return (
    <aside className="hud hud-emissions">
      <div className="hud-title">Концентрации · мкг/м³</div>

      <label className="emission-toggle">
        <input
          type="checkbox"
          checked={visible}
          onChange={(event) => setVisible(event.target.checked)}
        />
        <span>Показывать слой</span>
      </label>

      <div className="emission-tabs" role="group" aria-label="Загрязнитель">
        {POLLUTANTS.map((id) => (
          <button
            key={id}
            type="button"
            className={id === pollutant ? 'active' : undefined}
            title={POLLUTANT_INFO[id].description}
            onClick={() => setPollutant(id)}
          >
            {POLLUTANT_INFO[id].label}
          </button>
        ))}
      </div>

      <div
        className="emission-ramp"
        style={{ background: rampCss(info.stops) }}
      />
      <div className="emission-scale">
        <span>0</span>
        <span>{current ? formatConcentration(current.max) : '—'}</span>
      </div>

      {current ? (
        <dl className="emission-stats">
          <dt>max</dt>
          <dd>{formatConcentration(current.max)}</dd>
          <dt>p95</dt>
          <dd>{formatConcentration(current.p95)}</dd>
          <dt>среднее</dt>
          <dd>{formatConcentration(current.mean)}</dd>
        </dl>
      ) : (
        <div className="hud-muted">нет поля {info.label}</div>
      )}

      <div className="hud-muted">
        сетка {cols}×{rows}
        {ageSeconds !== null
          ? ` · ${ageSeconds} с назад`
          : frameTime !== null
            ? ` · кадр ${frameTime}`
            : ''}
      </div>
    </aside>
  );
}
