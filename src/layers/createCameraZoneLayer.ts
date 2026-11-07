import { PolygonLayer, TextLayer } from '@deck.gl/layers';
import type { CameraZone, Vec2 } from '../types/tracking';

function centroid(polygon: Vec2[]): Vec2 {
  let lon = 0;
  let lat = 0;
  for (const point of polygon) {
    lon += point[0];
    lat += point[1];
  }
  return [lon / polygon.length, lat / polygon.length];
}

export function createCameraZoneLayer(zones: CameraZone[]) {
  return new PolygonLayer<CameraZone>({
    id: 'camera-zones',
    data: zones,
    getPolygon: (zone) => zone.polygon,
    getFillColor: (zone) => zone.color,
    getLineColor: [255, 255, 255, 90],
    getLineWidth: 1,
    lineWidthUnits: 'pixels',
    lineWidthMinPixels: 1,
    stroked: true,
    filled: true,
    pickable: false,
  });
}

export function createCameraLabelLayer(zones: CameraZone[]) {
  return new TextLayer<CameraZone>({
    id: 'camera-labels',
    data: zones,
    getPosition: (zone) => centroid(zone.polygon),
    getText: (zone) => `CAM ${zone.camera_id}`,
    getSize: 12,
    sizeUnits: 'pixels',
    getColor: [226, 232, 240, 230],
    getBackgroundColor: [15, 23, 42, 210],
    background: true,
    getBorderColor: [148, 163, 184, 60],
    getBorderWidth: 1,
    backgroundPadding: [7, 3],
    pickable: false,
  });
}
