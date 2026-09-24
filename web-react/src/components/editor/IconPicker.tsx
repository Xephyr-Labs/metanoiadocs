import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useOutsideClick } from '../../hooks/useOutsideClick';
import { PageIcon } from '../ui/PageIcon';

// Big static set, grouped. Still no emoji library — just data.
const GROUPS: { name: string; emojis: string[] }[] = [
  {
    name: 'Docs & writing',
    emojis: [
      '📄', '📝', '📃', '📜', '📑', '📚', '📖', '📓', '📔', '📒',
      '📕', '📗', '📘', '📙', '🗞️', '📰', '✏️', '✒️', '🖊️', '🖋️',
      '🖍️', '📐', '📏', '🔤', '🔡', '💮',
    ],
  },
  {
    name: 'Work & planning',
    emojis: [
      '📊', '📈', '📉', '📋', '🗂️', '📁', '📂', '🗃️', '🗄️', '📌',
      '📍', '📎', '🖇️', '🔖', '🏷️', '📅', '🗓️', '📆', '⏰', '⏱️',
      '⏳', '⌛', '🕐', '🗳️', '💼', '🗒️',
    ],
  },
  {
    name: 'Ideas & goals',
    emojis: [
      '💡', '🎯', '🚀', '🔥', '⭐', '🌟', '✨', '⚡', '💫', '☄️',
      '✅', '☑️', '✔️', '❌', '❓', '❗', '⚠️', '🚩', '🏁', '🎖️',
      '🏆', '🥇', '🥈', '🥉', '🏅', '💯',
    ],
  },
  {
    name: 'Tech & science',
    emojis: [
      '💻', '🖥️', '⌨️', '🖱️', '📱', '☎️', '📞', '🔌', '🔋', '💾',
      '💿', '📀', '🖨️', '📡', '🛰️', '🤖', '👾', '🕹️', '🎮', '⚙️',
      '🛠️', '🔧', '🔨', '⚒️', '🪛', '🧰', '🔩', '🧲', '🧪', '🔬',
      '🔭', '🧬', '💊', '🩺', '🧫', '⚗️',
    ],
  },
  {
    name: 'People & talk',
    emojis: [
      '💬', '🗨️', '💭', '🗯️', '📣', '📢', '🔔', '🔕', '📧', '✉️',
      '📨', '📩', '📤', '📥', '📮', '👥', '👤', '🤝', '👋', '👍',
      '👎', '👏', '🙌', '💪', '🧠', '👀', '🗣️', '🫱', '✍️', '🙏',
    ],
  },
  {
    name: 'Money & business',
    emojis: [
      '💰', '💵', '💴', '💶', '💷', '💳', '🪙', '💎', '🏦', '🏢',
      '🏛️', '🏭', '📦', '🛒', '🛍️', '⚖️', '💹', '🧾', '🤑', '🪪',
    ],
  },
  {
    name: 'Nature & weather',
    emojis: [
      '🌱', '🌿', '🍀', '🌵', '🌲', '🌳', '🌴', '🌷', '🌸', '🌺',
      '🌻', '🌼', '🌹', '🍁', '🍂', '🍄', '🌾', '🌍', '🌎', '🌏',
      '🌕', '🌙', '☀️', '🌤️', '⛅', '🌧️', '⛈️', '🌪️', '🌈', '❄️',
      '⛄', '🌊', '💧', '⛰️', '🏔️', '🌋', '🏕️', '🪐',
    ],
  },
  {
    name: 'Food & drink',
    emojis: [
      '☕', '🍵', '🧃', '🥤', '🍺', '🍷', '🥂', '🍎', '🍊', '🍋',
      '🍉', '🍇', '🍓', '🍒', '🍑', '🍍', '🥝', '🥑', '🥐', '🍞',
      '🧀', '🍔', '🍕', '🌮', '🌯', '🍣', '🍜', '🍝', '🥗', '🍿',
      '🍩', '🍪', '🎂', '🍰', '🧁', '🍫', '🍬', '🍯',
    ],
  },
  {
    name: 'Places & travel',
    emojis: [
      '✈️', '🚗', '🚕', '🚌', '🚂', '🚄', '🚢', '⛵', '🚲', '🛵',
      '🏍️', '🚁', '🗺️', '🧭', '🏠', '🏡', '🏗️', '🏰', '🏯', '🗼',
      '🗽', '⛺', '🏖️', '🏝️', '🌉', '🌆', '🛤️', '⛽',
    ],
  },
  {
    name: 'Fun & games',
    emojis: [
      '🎨', '🎭', '🎬', '🎤', '🎧', '🎵', '🎶', '🎸', '🎹', '🥁',
      '🎺', '🎻', '🎲', '♟️', '🧩', '🎳', '⚽', '🏀', '🏈', '⚾',
      '🎾', '🏐', '🏓', '🥊', '🎿', '🛹', '🎣', '🎁', '🎈', '🎉',
      '🎊', '🪄', '🎪', '🎡', '🎢',
    ],
  },
  {
    name: 'Animals',
    emojis: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯',
      '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🦅', '🦉',
      '🦄', '🐴', '🐝', '🦋', '🐌', '🐢', '🐍', '🐙', '🦀', '🐠',
      '🐬', '🐳', '🦈', '🦕', '🐘', '🦒',
    ],
  },
  {
    name: 'Smileys',
    emojis: [
      '😀', '😄', '😁', '😆', '😅', '😂', '🙂', '😉', '😊', '😍',
      '🤩', '😎', '🤓', '🧐', '🤔', '🤯', '😴', '🤒', '🥳', '😇',
      '🤠', '🥸', '😈', '👻', '💀', '👽', '🎃', '🤡', '😺', '🙈',
    ],
  },
  {
    name: 'Symbols',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '💖',
      '🔒', '🔓', '🔑', '🗝️', '🛡️', '⚔️', '🔮', '🧿', '♻️', '🔄',
      '🔁', '➕', '➖', '✖️', '➗', '🆕', '🆗', '🆒', '🆙', '🔝',
      '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟥', '🟧',
      '🟨', '🟩', '🟦', '🟪', '⬛', '⬜', '🔺', '🔻', '🔶', '🔷',
    ],
  },
];

/** Click the page glyph to pick an emoji. Grouped scrollable grid, no dependency. */
export function IconPicker({ icon, onPick, trigger, label = 'Change page icon', onReset }: {
  icon: string;
  onPick: (icon: string) => void;
  /** What the button shows; the page glyph when not given. */
  trigger?: ReactNode;
  label?: string;
  /** Offers a way back to having no emoji — a database's initial tile. */
  onReset?: { label: string; run: () => void };
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClick(ref, useCallback(() => setOpen(false), []), open);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        title={label}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors duration-120 hover:bg-hover"
      >
        {trigger ?? <PageIcon icon={icon} size={18} />}
      </button>
      {open && (
        <div className="scrollarea absolute left-0 top-8 z-40 max-h-[340px] w-[312px] overflow-y-auto rounded-lg border border-line bg-canvas p-2 shadow-pop">
          {onReset && (
            <button
              type="button"
              onClick={() => { onReset.run(); setOpen(false); }}
              className="mb-1 flex h-7 w-full items-center rounded px-1.5 text-sm text-muted hover:bg-hover hover:text-ink"
            >
              {onReset.label}
            </button>
          )}
          {GROUPS.map((g) => (
            <div key={g.name}>
              <div className="px-1 pb-1 pt-2 text-2xs font-medium text-faint first:pt-0.5">{g.name}</div>
              <div className="grid grid-cols-9 gap-0.5">
                {g.emojis.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => { onPick(e); setOpen(false); }}
                    className="flex h-7 w-7 items-center justify-center rounded text-md hover:bg-hover"
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
