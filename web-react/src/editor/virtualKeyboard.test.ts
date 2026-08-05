import { describe, expect, it } from 'vitest';
import { createVirtualKeyboardProvider } from './virtualKeyboard';

describe('createVirtualKeyboardProvider', () => {
  it('provides a safe desktop fallback without viewport or keyboard APIs', () => {
    const provider = createVirtualKeyboardProvider(null, null);

    expect(provider.visible$.value).toBe(false);
    expect(provider.height$.value).toBe(0);
    expect(() => provider.show?.()).not.toThrow();
    expect(() => provider.hide?.()).not.toThrow();
  });
});
