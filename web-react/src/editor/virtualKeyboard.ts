import { signal } from '@preact/signals-core';

interface ViewportLike {
  height: number;
  offsetTop: number;
  scale?: number;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
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

// Providers alive now (one per mounted editor); see dispose().
let live = 0;

// Below this a height change is the address bar, not a keyboard.
const MIN_KEYBOARD = 120;

/** Keyboard height, and how much of the layout it covers.
 *
 *  Android is told to resize the layout for the keyboard (interactive-widget
 *  in index.html), so once the layout catches up, innerHeight minus the visual
 *  viewport is 0 again with the keyboard still open. BlockSuite's phone toolbar
 *  reads that as "the keyboard was closed" and blurs the editor, which really
 *  does close it. So the height is measured against the tallest layout seen at
 *  this width — remembered per width, so turning the phone round and back with
 *  the keyboard up does not start from an already-shrunk layout. iOS never
 *  shrinks the layout, so for it nothing changes.
 *
 *  The keyboard's height leaves out offsetTop: iOS pans the visible area down
 *  the page while the keyboard is up, which moves it but does not shrink the
 *  keyboard, and counting the pan read a long scroll as the keyboard closing.
 *  `overlay` (how much of the layout is covered below the visible area) does
 *  count it. */
export function createKeyboardMeter() {
  const tallest = new Map<number, number>();
  return (layoutWidth: number, layoutHeight: number, viewportHeight: number, offsetTop: number) => {
    // ponytail: a width first seen with the keyboard already up (rotating to
    // landscape mid-edit) starts from the shrunk layout and reads no keyboard.
    const top = Math.max(tallest.get(layoutWidth) ?? 0, layoutHeight);
    tallest.set(layoutWidth, top);
    const overlay = Math.max(0, layoutHeight - viewportHeight - offsetTop);
    const height = Math.max(0, top - viewportHeight);
    return { height: height >= MIN_KEYBOARD ? height : 0, overlay };
  };
}

/** show/hide are BlockSuite's way to put the keyboard away while its insert or
 *  style panel takes the keyboard's place, and bring it back after. No phone
 *  browser can do that from script, so it is done the one way that works: the
 *  focused editor gets inputmode="none" (no keyboard) and loses it again.
 *  BlockSuite's own fallback does the same but never undoes it when the editor
 *  loses focus, so a panel left open by tapping away kept the keyboard from
 *  ever coming back. Here it is undone by show(), by the editor losing focus,
 *  and by a tap back into the text. */
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
    // Where the visible area ends, in the coordinates fixed elements use.
    document.documentElement.style.setProperty('--vv-bottom', `${Math.round(viewport.offsetTop + viewport.height)}px`);
    // Pinch-zoom shrinks the visible area too; that is not the keyboard.
    if ((viewport.scale ?? 1) > 1.01) return;
    const { height, overlay } = measure(window.innerWidth, window.innerHeight, viewport.height, viewport.offsetTop);
    visible$.value = height > 0;
    height$.value = height;
    // For CSS: how much of the layout the keyboard covers (iOS never shrinks
    // the layout for it), the room the page leaves below its last line.
    document.documentElement.style.setProperty('--kb', `${Math.round(overlay)}px`);
  };

  let disposed = false;
  let muted: HTMLElement | null = null;
  let mutedWas = '';
  const show = () => {
    if (!muted) return;
    muted.inputMode = mutedWas;
    muted = null;
  };
  const hide = () => {
    const el = (typeof document === 'undefined' ? null : document.activeElement) as HTMLElement | null;
    if (muted || !el?.isContentEditable) return;
    muted = el;
    mutedWas = el.inputMode;
    el.inputMode = 'none';
  };
  const onFocusOut = (e: Event) => { if (e.target === muted) show(); };
  const onPointerDown = (e: Event) => { if (muted && e.target instanceof Node && muted.contains(e.target)) show(); };

  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
  if (typeof document !== 'undefined') {
    live++;
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('pointerdown', onPointerDown, true);
  }
  update();

  return {
    visible$,
    height$,
    show,
    hide,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      show();
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      if (typeof document !== 'undefined') {
        document.removeEventListener('focusout', onFocusOut, true);
        document.removeEventListener('pointerdown', onPointerDown, true);
        // Left set, a page closed with the keyboard up kept its padding on
        // every view after it. Page-wide values, though, and a version
        // preview's editor can sit over the page's: only the last one out
        // clears them.
        if (--live === 0) {
          document.documentElement.style.removeProperty('--kb');
          document.documentElement.style.removeProperty('--vv-bottom');
        }
      }
    },
  };
}
