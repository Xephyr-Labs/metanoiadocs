import { useEffect } from 'react';
import { useWorkspace } from '../store/workspace';

/** App-level keyboard shortcuts. Editor-local keys stay inside BlockSuite. */
export function useGlobalHotkeys() {
  const ws = useWorkspace();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ws.setPaletteOpen(true);
      } else if (mod && e.key === '\\') {
        e.preventDefault();
        ws.setSidebarCollapsed(!ws.sidebarCollapsed);
      } else if (mod && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        ws.toggleTheme();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ws]);
}
