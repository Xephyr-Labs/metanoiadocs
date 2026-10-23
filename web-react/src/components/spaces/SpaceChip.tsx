import { ChevronDown, Layers } from 'lucide-react';
import { EmojiIcon } from '../../hooks/useMoveToSpace';
import type { SpaceFilter } from '../../lib/spaceTree';
import { useWorkspace } from '../../store/workspace';
import { Menu } from '../ui/Menu';

/** Which spaces a list covers: yours (the default), every space, or one. */
export function SpaceChip({ value, onChange }: { value: SpaceFilter; onChange: (v: SpaceFilter) => void }) {
  const ws = useWorkspace();
  if (!ws.spaces.length) return null;
  const one = ws.spaces.find((s) => s.id === value);
  const label = value === 'all' ? 'All spaces' : one ? `${one.icon} ${one.name}` : 'Joined spaces';
  return (
    <Menu
      items={[
        { icon: Layers, label: 'Joined spaces', checked: value === 'joined', onSelect: () => onChange('joined') },
        { icon: Layers, label: 'All spaces', checked: value === 'all', onSelect: () => onChange('all') },
        ...ws.spaces.map((s, i) => ({
          icon: EmojiIcon(s.icon),
          label: s.name,
          separatorBefore: i === 0,
          checked: value === s.id,
          onSelect: () => onChange(s.id),
        })),
      ]}
      trigger={
        <button
          type="button"
          aria-label={`Spaces: ${label}`}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-surface px-2.5 text-sm text-ink ring-1 ring-inset ring-line transition-colors duration-120 hover:bg-hover"
        >
          <span className="max-w-[160px] truncate">{label}</span>
          <ChevronDown size={14} className="shrink-0 text-faint" />
        </button>
      }
    />
  );
}
