import { signal } from '@preact/signals-core';

interface ViewportLike {
  height: number;
  offsetTop: number;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

interface KeyboardLike {
  show?: () => void;
  hide?: () => void;
}

export interface VirtualKeyboardProvider {
  readonly visible$: ReturnType<typeof signal<boolean>>;
  readonly height$: ReturnType<typeof signal<number>>;
  show: () => void;
  hide: () => void;
  dispose: () => void;
}

function browserViewport(): ViewportLike | null {
  if (typeof window === 'undefined' || !window.visualViewport) return null;
  return window.visualViewport;
}

function browserKeyboard(): KeyboardLike | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as Navigator & { virtualKeyboard?: KeyboardLike }).virtualKeyboard ?? null;
}

export function createVirtualKeyboardProvider(
  viewport: ViewportLike | null = browserViewport(),
  keyboard: KeyboardLike | null = browserKeyboard(),
) {
  const visible$ = signal(false);
  const height$ = signal(0);

  const update = () => {
    if (!viewport || typeof window === 'undefined') {
      visible$.value = false;
      height$.value = 0;
      return;
    }
    const height = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    visible$.value = height > 0;
    height$.value = height;
  };

  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
  update();

  return {
    visible$,
    height$,
    show: () => keyboard?.show?.(),
    hide: () => keyboard?.hide?.(),
    dispose: () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
    },
  };
}
