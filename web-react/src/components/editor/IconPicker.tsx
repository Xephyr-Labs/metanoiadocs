import { useCallback, useRef, useState } from 'react';
import { useOutsideClick } from '../../hooks/useOutsideClick';
import { PageIcon } from '../ui/PageIcon';

// Curated set — enough range without shipping an emoji library.
const EMOJIS = [
  '📄', '📝', '📚', '📖', '📊', '📈', '📋', '🗂️',
  '💡', '🎯', '🚀', '🔥', '⭐', '✅', '📌', '🔖',
  '🧠', '🛠️', '⚙️', '🧪', '🔬', '💻', '🌐', '🔒',
  '📅', '🗓️', '⏰', '💬', '👥', '🤝', '🏆', '🎨',
  '💰', '📦', '🧭', '🗺️', '🌱', '☕', '❤️', '⚠️',
];

/** Click the page glyph to pick an emoji. Small curated grid, no dependency. */
export function IconPicker({ icon, onPick }: { icon: string; onPick: (icon: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClick(ref, useCallback(() => setOpen(false), []), open);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Change page icon"
        className="flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-120 hover:bg-hover"
      >
        <PageIcon icon={icon} size={18} />
      </button>
      {open && (
        <div className="absolute left-0 top-8 z-40 grid w-[248px] grid-cols-8 gap-0.5 rounded-lg border border-line bg-canvas p-2 shadow-pop">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => { onPick(e); setOpen(false); }}
              className="flex h-7 w-7 items-center justify-center rounded text-[16px] hover:bg-hover"
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
