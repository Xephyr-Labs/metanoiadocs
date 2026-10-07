import { describe, expect, it } from 'vitest';
import { createKeyboardMeter, createVirtualKeyboardProvider } from './virtualKeyboard';

describe('createVirtualKeyboardProvider', () => {
  it('provides a safe desktop fallback without viewport or keyboard APIs', () => {
    const provider = createVirtualKeyboardProvider(null, null);

    expect(provider.visible$.value).toBe(false);
    expect(provider.height$.value).toBe(0);
    expect(() => provider.show?.()).not.toThrow();
    expect(() => provider.hide?.()).not.toThrow();
  });
});

describe('createKeyboardMeter', () => {
  it('keeps the keyboard open on Android once the layout shrinks to match it', () => {
    const meter = createKeyboardMeter();
    expect(meter(412, 839, 839, 0).height).toBe(0);
    // The keyboard overlays the visual viewport first…
    expect(meter(412, 839, 539, 0)).toEqual({ height: 300, overlay: 300 });
    // …then resizes-content shrinks the layout. Still open; nothing to lift.
    expect(meter(412, 539, 539, 0)).toEqual({ height: 300, overlay: 0 });
    // Closed: the layout grows back.
    expect(meter(412, 839, 839, 0).height).toBe(0);
  });

  it('measures iOS, where the layout never shrinks, as before', () => {
    const meter = createKeyboardMeter();
    meter(390, 664, 664, 0);
    expect(meter(390, 664, 364, 0)).toEqual({ height: 300, overlay: 300 });
  });

  it('ignores the address bar showing and hiding', () => {
    const meter = createKeyboardMeter();
    meter(412, 895, 895, 0);
    expect(meter(412, 839, 839, 0).height).toBe(0);
  });

  it('starts over when the width changes (rotation)', () => {
    const meter = createKeyboardMeter();
    meter(412, 839, 839, 0);
    expect(meter(839, 412, 412, 0).height).toBe(0);
  });
});
