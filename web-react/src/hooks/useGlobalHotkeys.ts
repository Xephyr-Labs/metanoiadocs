import { useEffect, useRef } from 'react';
import { resolveHotkey, type HotkeyAction } from '../lib/hotkeys';
import { isInDialog, isTyping } from '../lib/typing';
import { useWorkspace } from '../store/workspace';

/** How long a `g` stays armed, waiting for the letter that says where to go. */
const CHORD_MS = 1200;

/** App-level keyboard shortcuts. Editor-local keys stay inside BlockSuite, and
 *  what each key means lives in lib/hotkeys — this is the wiring. */
export function useGlobalHotkeys() {
  const ws = useWorkspace();
  // A ref, not state: nothing renders differently because `g` is armed.
  const chord = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    const run: Record<HotkeyAction, () => void> = {
      palette: () => ws.setPaletteOpen(true),
      sidebar: () => ws.setSidebarCollapsed(!ws.sidebarCollapsed),
      theme: ws.toggleTheme,
      shortcuts: () => ws.setShortcutsOpen(true),
      capture: () => ws.setCaptureOpen(true),
      home: ws.openHome,
      tasks: ws.openTasks,
      docs: ws.openAllDocs,
      inbox: () => ws.setInboxOpen(true),
      // Create what the screen is about: on a database that is a task, and a
      // page everywhere else.
      create: () => {
        if (ws.view === 'project' && ws.activeProjectId) void ws.createTaskIn(ws.activeProjectId);
        else void ws.createPage(null);
      },
    };

    // A modifier pressed on its own is not a keystroke yet — it is the first
    // half of one. Letting it through here would clear an armed `g` the moment
    // someone reached for Shift to type the capital letter after it.
    const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Dead']);

    const onKey = (e: KeyboardEvent) => {
      if (MODIFIER_KEYS.has(e.key)) return;
      const armed = chord.current && Date.now() - chord.current.at < CHORD_MS ? chord.current.key : null;
      const hit = resolveHotkey(e, {
        typing: isTyping(e.target),
        inDialog: isInDialog(e.target),
        armed,
      });
      // Only a key that arms a chord leaves one armed. Anything else — a hit, a
      // miss, a letter meant for the page — clears it, so `g` does not sit
      // waiting through the rest of a sentence.
      chord.current = hit?.arm ? { key: hit.arm, at: Date.now() } : null;
      if (!hit?.action) return;
      e.preventDefault();
      run[hit.action]();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ws]);
}
