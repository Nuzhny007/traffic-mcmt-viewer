import { useEffect, useMemo, useRef, useState } from 'react';
import Map, {
  NavigationControl,
  useControl,
  type MapRef,
} from 'react-map-gl/maplibre';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { Layer, PickingInfo } from '@deck.gl/core';

import { appConfig } from '../config';
import {
  createCameraLabelLayer,
  createCameraZoneLayer,
} from '../layers/createCameraZoneLayer';
import { createEmissionLayer } from '../layers/createEmissionLayer';
import { createTrackPathLayer } from '../layers/createTrackPathLayer';
import { createTrackPointLayer } from '../layers/createTrackPointLayer';
import { emissionBuffer } from '../net/emissionBuffer';
import { trackBuffer } from '../net/feed';
import type { LiveTrack } from '../net/trackBuffer';
import { useEmissionStore } from '../store/emissionStore';
import { useTrackingStore } from '../store/trackingStore';
import type { CameraZone, Vec2 } from '../types/tracking';

type Bounds = [[number, number], [number, number]];

function boundsOf(points: readonly Vec2[]): Bounds | null {
  if (points.length === 0) {
    return null;
  }
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of points) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}

function zonesBounds(zones: readonly CameraZone[]): Bounds | null {
  const points: Vec2[] = [];
  for (const zone of zones) {
    points.push(...zone.polygon);
  }
  return boundsOf(points);
}

interface MapViewProps {
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}

/**
 * Must be rendered inside <Map>: useControl resolves the map instance from
 * react-map-gl context, which only exists for children of the map.
 */
function DeckOverlay({ selectedId, onSelect }: MapViewProps) {
  // Overlaid (non-interleaved) mode is used deliberately: deck.gl 9.4's
  // interleaved MapboxLayerGroup calls map.transform.height, which is not
  // available in this MapLibre integration. Overlaid mode renders into its own
  // canvas, keeps picking working through MapboxOverlay and avoids the issue.
  const overlay = useControl<MapboxOverlay>(
    () => new MapboxOverlay({ interleaved: false, layers: [] }),
  );

  const zones = useTrackingStore((state) => state.zones);
  const zoneList = useMemo(() => Array.from(zones.values()), [zones]);

  // Imperative render loop: WebSocket messages only bump `trackBuffer.version`,
  // layers are rebuilt from the mutable buffer on the next animation frame.
  // No React render is involved per message.
  useEffect(() => {
    let frame = 0;
    let lastVersion = -1;
    let lastSelected: number | null | undefined;
    let lastZones: typeof zoneList | null = null;
    let lastEmissionKey = '';

    const render = () => {
      frame = requestAnimationFrame(render);

      const emissionState = useEmissionStore.getState();
      const emissionKey = `${emissionBuffer.version}:${emissionState.visible}:${emissionState.pollutant}`;

      if (
        trackBuffer.version === lastVersion &&
        selectedId === lastSelected &&
        zoneList === lastZones &&
        emissionKey === lastEmissionKey
      ) {
        return;
      }

      lastVersion = trackBuffer.version;
      lastSelected = selectedId;
      lastZones = zoneList;
      lastEmissionKey = emissionKey;

      const tracks = trackBuffer.list();
      const layers: Layer[] = [];
      const emissionLayer = createEmissionLayer(
        emissionBuffer.frame,
        emissionState.pollutant,
        emissionState.visible,
      );
      if (emissionLayer) {
        layers.push(emissionLayer);
      }
      layers.push(
        createCameraZoneLayer(zoneList),
        createCameraLabelLayer(zoneList),
        createTrackPathLayer(tracks),
        createTrackPointLayer(tracks, selectedId),
      );

      overlay.setProps({ layers });
    };

    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [overlay, selectedId, zoneList]);

  useEffect(() => {
    overlay.setProps({
      onClick: (info: PickingInfo) => {
        const track = info.object as LiveTrack | undefined;
        onSelect(track ? track.id : null);
      },
      getCursor: ({ isHovering, isDragging }) =>
        isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab',
    });
  }, [overlay, onSelect]);

  return null;
}

export function MapView({ selectedId, onSelect }: MapViewProps) {
  const mapRef = useRef<MapRef | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const fittedRef = useRef(false);

  const zones = useTrackingStore((state) => state.zones);
  const zoneList = useMemo(() => Array.from(zones.values()), [zones]);
  const trackCount = useTrackingStore((state) => state.trackCount);

  // The gateway serves both Aire (France) and Auburn (USA) datasets from the
  // same fixed URL, so the initial view from .env cannot match both. Fit once
  // to the first camera zones, or to the first tracks when the config has no
  // polygon. User interaction after that is never overridden.
  useEffect(() => {
    if (!appConfig.mapAutofit || fittedRef.current || !mapReady) {
      return;
    }
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const bounds =
      zonesBounds(zoneList) ??
      boundsOf(trackBuffer.list().map((track) => track.position));
    if (!bounds) {
      return;
    }

    fittedRef.current = true;
    const [[minLon, minLat], [maxLon, maxLat]] = bounds;
    if (maxLon - minLon < 1e-6 && maxLat - minLat < 1e-6) {
      map.jumpTo({ center: [(minLon + maxLon) / 2, (minLat + maxLat) / 2], zoom: 17 });
      return;
    }
    map.fitBounds(bounds, { padding: 80, maxZoom: 18, duration: 0 });
  }, [mapReady, zoneList, trackCount]);

  return (
    <div className="map-canvas">
      <Map
        ref={mapRef}
        initialViewState={appConfig.initialView}
        mapStyle={appConfig.mapStyle}
        attributionControl={{ compact: true }}
        style={{ width: '100%', height: '100%' }}
        onLoad={() => setMapReady(true)}
      >
        <DeckOverlay selectedId={selectedId} onSelect={onSelect} />
        <NavigationControl position="bottom-right" visualizePitch />
      </Map>
    </div>
  );
}
