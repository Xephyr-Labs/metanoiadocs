import { signal } from '@preact/signals-core';

interface ViewportLike {
  height: number;
  offsetTop: number;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

export interface VirtualKeyboardProvider {
  readonly visible$: ReturnType<typeof signal<boolean>>;
  readonly height$: ReturnType<typeof signal<number>>;
  dispose: () => void;
}

function browserViewport(): ViewportLike | null {
  if (typeof window === 'undefined' || !window.visualViewport) return null;
  return window.visualViewport;
}

// Below this a height change is the address bar, not a keyboard.
const MIN_KEYBOARD = 120;

/** Keyboard height, and how much of the layout it covers.
 *
 *  Android is told to resize the layout for the keyboard (interactive-widget
 *  in index.html), so once the layout catches up, innerHeight minus the visual
 *  viewport is 0 again with the keyboard still open. BlockSuite's phone toolbar
 *  reads that as "the keyboard was closed" and blurs the editor, which really
 *  does close it. So the height is measured against the tallest layout seen at
 *  this width; iOS never shrinks the layout, so for it nothing changes.
 *  `overlay` is what still has to be lifted by hand (iOS only). */
export function createKeyboardMeter() {
  let width = -1;
  let tallest = 0;
  return (layoutWidth: number, layoutHeight: number, viewportHeight: number, offsetTop: number) => {
    if (layoutWidth !== width) { width = layoutWidth; tallest = 0; }
    tallest = Math.max(tallest, layoutHeight);
    const overlay = Math.max(0, layoutHeight - viewportHeight - offsetTop);
    const height = Math.max(0, tallest - viewportHeight - offsetTop);
    return { height: height >= MIN_KEYBOARD ? height : 0, overlay };
  };
}

/** No show/hide on purpose: neither phone browser can do it from script
 *  (navigator.virtualKeyboard only acts under virtualkeyboardpolicy=manual,
 *  and iOS has no such API). Without them BlockSuite's phone toolbar falls back
 *  to inputmode="none" on the editor, which does put the keyboard away when its
 *  insert/style panel opens and brings it back when the panel closes. With
 *  no-op versions here the panel opened behind a keyboard that never moved. */
export function createVirtualKeyboardProvider(viewport: ViewportLike | null = browserViewport()) {
  const visible$ = signal(false);
  const height$ = signal(0);
  const measure = createKeyboardMeter();

  const update = () => {
    if (!viewport || typeof window === 'undefined') {
      visible$.value = false;
      height$.value = 0;
      return;
    }
    const { height, overlay } = measure(window.innerWidth, window.innerHeight, viewport.height, viewport.offsetTop);
    visible$.value = height > 0;
    height$.value = height;
    // For CSS: iOS never shrinks the layout for the keyboard, so anything
    // pinned to the bottom (the keyboard toolbar) has to be lifted by hand.
    document.documentElement.style.setProperty('--kb', `${Math.round(overlay)}px`);
  };

  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
  update();

  return {
    visible$,
    height$,
    dispose: () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
    },
  };
}
