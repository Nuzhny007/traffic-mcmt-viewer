import { nowMs } from '../domain/clock';
import { classColor, classLabel } from '../domain/classes';
import type { LiveTrack } from '../net/trackBuffer';

interface TrackDetailsProps {
  track: LiveTrack;
  /** True when the current filter hides this track from the map. */
  hiddenByFilter: boolean;
  onClear: () => void;
}

export function TrackDetails({ track, hiddenByFilter, onClear }: TrackDetailsProps) {
  const [r, g, b] = classColor(track.className);

  return (
    <aside className="hud hud-details">
      <div className="hud-title">Трек #{track.id}</div>
      <dl>
        <dt>Класс</dt>
        <dd>
          <span className="legend-dot" style={{ backgroundColor: `rgb(${r}, ${g}, ${b})` }} />
          {classLabel(track.className)}
        </dd>
        <dt>Камера</dt>
        <dd>CAM {track.cameraId}</dd>
        <dt>Позиция</dt>
        <dd>
          {track.position[1].toFixed(5)}, {track.position[0].toFixed(5)}
        </dd>
        <dt>Скорость</dt>
        <dd>{track.speedKmh.toFixed(1)} км/ч</dd>
        <dt>Точек в хвосте</dt>
        <dd>{track.trail.length}</dd>
        <dt>Обновлён</dt>
        <dd>{((nowMs() - track.lastSeen) / 1000).toFixed(1)} с назад</dd>
      </dl>
      {hiddenByFilter && (
        <div className="hud-muted details-note">скрыт текущим фильтром — на карте не показан</div>
      )}
      <button type="button" onClick={onClear}>
        Сбросить выбор
      </button>
    </aside>
  );
}
