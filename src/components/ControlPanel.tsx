import { useEffect, useMemo, useState } from 'react';

import { ALL_CLASSES, classColor, classLabel } from '../domain/classes';
import { parseTrackQuery } from '../domain/filter';
import { trackBuffer } from '../net/feed';
import { useTrackingStore } from '../store/trackingStore';
import { MIN_SPEED_LIMIT, useViewStore } from '../store/viewStore';

/**
 * Layer switches and track filters. Everything here is low-frequency UI state;
 * the renderer reads the same store from its animation loop, so a click never
 * goes through a per-frame React path.
 */
export function ControlPanel() {
  const view = useViewStore();
  const zones = useTrackingStore((state) => state.zones);
  const classCounts = useTrackingStore((state) => state.classCounts);
  const cameraCounts = useTrackingStore((state) => state.cameraCounts);
  const visibleCount = useTrackingStore((state) => state.visibleCount);
  const trackCount = useTrackingStore((state) => state.trackCount);
  const select = useTrackingStore((state) => state.select);

  const [queryText, setQueryText] = useState(view.query);
  const [searchMiss, setSearchMiss] = useState<number | null>(null);

  // Keep the input in sync when the view is reset or a URL is loaded.
  useEffect(() => {
    setQueryText(view.query);
    setSearchMiss(null);
  }, [view.query]);

  const cameras = useMemo(() => {
    const ids = new Set<number>(zones.keys());
    for (const id of Object.keys(cameraCounts)) {
      ids.add(Number(id));
    }
    return [...ids].sort((a, b) => a - b);
  }, [zones, cameraCounts]);

  const submitSearch = () => {
    const id = parseTrackQuery(queryText);
    view.setQuery(queryText);
    if (id === null) {
      setSearchMiss(null);
      return;
    }
    if (trackBuffer.get(id)) {
      select(id);
      setSearchMiss(null);
    } else {
      setSearchMiss(id);
    }
  };

  const clearSearch = () => {
    setQueryText('');
    setSearchMiss(null);
    view.setQuery('');
  };

  return (
    <aside className="hud hud-controls">
      <div className="controls-head">
        <span className="hud-title">Слои и фильтры</span>
        <button type="button" className="controls-reset" title="Сбросить фильтры" onClick={view.reset}>
          сброс
        </button>
      </div>

      <div className="controls-block">
        {ALL_CLASSES.map((className, index) => {
          const active = view.classes.includes(className);
          const [r, g, b] = classColor(className);
          return (
            <button
              key={className}
              type="button"
              className={`chip${active ? ' active' : ''}`}
              aria-pressed={active}
              title={`${classLabel(className)} — клавиша ${index + 1}, двойной клик: только этот класс`}
              onClick={() => view.toggleClass(className)}
              onDoubleClick={() => view.onlyClass(className)}
            >
              <i className="legend-dot" style={{ backgroundColor: `rgb(${r}, ${g}, ${b})` }} />
              <span className="chip-label">{classLabel(className)}</span>
              <span className="chip-count">{classCounts[className] ?? 0}</span>
            </button>
          );
        })}
      </div>

      {cameras.length > 0 && (
        <div className="controls-block controls-chips-inline">
          {cameras.map((cameraId) => {
            const active = view.cameras.length === 0 || view.cameras.includes(cameraId);
            return (
              <button
                key={cameraId}
                type="button"
                className={`chip${active ? ' active' : ''}`}
                aria-pressed={active}
                title="Камера: фильтр по зоне"
                onClick={() => view.toggleCamera(cameraId, cameras)}
              >
                <span className="chip-label">CAM {cameraId}</span>
                <span className="chip-count">{cameraCounts[cameraId] ?? 0}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="controls-block">
        <label className="controls-toggle">
          <input
            type="checkbox"
            checked={view.showTrails}
            onChange={(event) => view.setShowTrails(event.target.checked)}
          />
          <span>Хвосты треков</span>
          <kbd>H</kbd>
        </label>
        <label className="controls-toggle">
          <input
            type="checkbox"
            checked={view.showZones}
            onChange={(event) => view.setShowZones(event.target.checked)}
          />
          <span>Зоны камер</span>
          <kbd>Z</kbd>
        </label>
      </div>

      <div className="controls-block">
        <label className="controls-range">
          <span>
            Мин. скорость <b>{view.minSpeedKmh} км/ч</b>
          </span>
          <input
            type="range"
            min={0}
            max={MIN_SPEED_LIMIT}
            step={5}
            value={view.minSpeedKmh}
            onChange={(event) => view.setMinSpeed(Number(event.target.value))}
          />
        </label>
      </div>

      <div className="controls-block">
        <div className="controls-search">
          <input
            type="text"
            inputMode="numeric"
            placeholder="трек #"
            value={queryText}
            onChange={(event) => setQueryText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                submitSearch();
              }
            }}
            aria-label="Найти трек по номеру"
          />
          <button type="button" onClick={submitSearch}>
            найти
          </button>
          {queryText !== '' && (
            <button type="button" className="controls-clear" onClick={clearSearch} title="Сбросить поиск">
              ×
            </button>
          )}
        </div>
        {searchMiss !== null && (
          <div className="hud-muted">трек #{searchMiss} не найден</div>
        )}
      </div>

      <div className="controls-footer hud-muted">
        показано {visibleCount} из {trackCount}
      </div>
    </aside>
  );
}
