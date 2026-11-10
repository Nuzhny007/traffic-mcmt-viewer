import { beforeEach, describe, expect, it } from 'vitest';

import { ALL_CLASSES } from '../domain/classes';
import {
  DEFAULT_VIEW,
  parseViewQuery,
  toViewQuery,
  useViewStore,
} from './viewStore';

beforeEach(() => {
  useViewStore.getState().reset();
  useViewStore.setState({ version: 0 });
});

describe('parseViewQuery', () => {
  it('returns the defaults for an empty search', () => {
    const view = parseViewQuery('');

    expect(view.classes).toEqual([...ALL_CLASSES]);
    expect(view.cameras).toEqual([]);
    expect(view.showTrails).toBe(true);
    expect(view.showZones).toBe(true);
    expect(view.minSpeedKmh).toBe(0);
    expect(view.query).toBe('');
    expect(view.emissionOpacity).toBe(DEFAULT_VIEW.emissionOpacity);
  });

  it('reads classes, cameras and layer switches', () => {
    const view = parseViewQuery('?classes=car,truck&cams=2,1&trails=0&zones=0');

    expect(view.classes).toEqual(['car', 'truck']);
    expect(view.cameras).toEqual([1, 2]);
    expect(view.showTrails).toBe(false);
    expect(view.showZones).toBe(false);
  });

  it('keeps only known classes and falls back when none are known', () => {
    expect(parseViewQuery('?classes=car,ufo').classes).toEqual(['car']);
    expect(parseViewQuery('?classes=ufo').classes).toEqual([...ALL_CLASSES]);
    expect(parseViewQuery('?classes=').classes).toEqual([...ALL_CLASSES]);
  });

  it('clamps numbers instead of failing the whole view', () => {
    expect(parseViewQuery('?min_speed=-10').minSpeedKmh).toBe(0);
    expect(parseViewQuery('?min_speed=500').minSpeedKmh).toBe(80);
    expect(parseViewQuery('?min_speed=abc').minSpeedKmh).toBe(0);
    expect(parseViewQuery('?opacity=5').emissionOpacity).toBe(1);
    expect(parseViewQuery('?opacity=0').emissionOpacity).toBe(0.1);
  });

  it('accepts the search box with and without a hash', () => {
    expect(parseViewQuery('?q=%231042').query).toBe('#1042');
    expect(parseViewQuery('?q=1042').query).toBe('1042');
  });
});

describe('toViewQuery', () => {
  it('serialises nothing for the default view', () => {
    expect(toViewQuery(DEFAULT_VIEW)).toBe('');
  });

  it('round-trips a non-default view', () => {
    const view = {
      classes: ['car', 'bike'] as ('car' | 'bike')[],
      cameras: [1],
      showTrails: false,
      showZones: false,
      minSpeedKmh: 15,
      query: '#42',
      emissionOpacity: 0.5,
    };

    const parsed = parseViewQuery(`?${toViewQuery(view)}`);

    expect(parsed.classes).toEqual(['car', 'bike']);
    expect(parsed.cameras).toEqual([1]);
    expect(parsed.showTrails).toBe(false);
    expect(parsed.showZones).toBe(false);
    expect(parsed.minSpeedKmh).toBe(15);
    expect(parsed.query).toBe('#42');
    expect(parsed.emissionOpacity).toBe(0.5);
  });

  it('orders classes in legend order regardless of the input order', () => {
    expect(toViewQuery({ ...DEFAULT_VIEW, classes: ['bike', 'car'] })).toBe(
      'classes=car%2Cbike',
    );
  });
});

describe('useViewStore', () => {
  it('bumps the version on every change', () => {
    const before = useViewStore.getState().version;

    useViewStore.getState().setShowTrails(false);

    expect(useViewStore.getState().version).toBe(before + 1);
    expect(useViewStore.getState().showTrails).toBe(false);
  });

  it('toggles a class back on and keeps legend order', () => {
    const store = useViewStore.getState();
    store.toggleClass('car');
    expect(useViewStore.getState().classes).not.toContain('car');

    store.toggleClass('car');
    expect(useViewStore.getState().classes).toEqual([...ALL_CLASSES]);
  });

  it('refuses to switch off the last visible class', () => {
    const store = useViewStore.getState();
    store.onlyClass('bus');

    useViewStore.getState().toggleClass('bus');

    expect(useViewStore.getState().classes).toEqual(['bus']);
  });

  it('restores all classes when the only one is clicked again', () => {
    useViewStore.getState().onlyClass('bus');
    useViewStore.getState().onlyClass('bus');

    expect(useViewStore.getState().classes).toEqual([...ALL_CLASSES]);
  });

  it('materialises the camera list on the first toggle', () => {
    // Empty means "all cameras"; hiding CAM 2 leaves CAM 1 visible.
    useViewStore.getState().toggleCamera(2, [1, 2]);

    expect(useViewStore.getState().cameras).toEqual([1]);
  });

  it('refuses to hide every camera', () => {
    useViewStore.getState().toggleCamera(1, [1]);

    expect(useViewStore.getState().cameras).toEqual([]);
  });

  it('clamps the speed limit and opacity', () => {
    useViewStore.getState().setMinSpeed(500);
    expect(useViewStore.getState().minSpeedKmh).toBe(80);

    useViewStore.getState().setEmissionOpacity(0);
    expect(useViewStore.getState().emissionOpacity).toBe(0.1);
  });

  it('resets to the defaults', () => {
    const store = useViewStore.getState();
    store.onlyClass('car');
    store.setShowZones(false);
    store.setMinSpeed(20);

    useViewStore.getState().reset();

    expect(useViewStore.getState().classes).toEqual([...ALL_CLASSES]);
    expect(useViewStore.getState().showZones).toBe(true);
    expect(useViewStore.getState().minSpeedKmh).toBe(0);
  });
});
