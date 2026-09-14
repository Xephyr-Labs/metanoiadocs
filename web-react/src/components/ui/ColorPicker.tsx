/* Hallmark · component: colour swatch menu · genre: modern-minimal
 * theme: project tokens (index.css) + tag palette (lib/tagColors)
 * pre-emit critique: P4 H5 E5 S4 R5 V3
 * states: default · hover · focus-visible · open · selected
 */
import { cn } from '../../lib/cn';
import { swatch, TAG_COLORS, type TagColor } from '../../lib/tagColors';
import { IconButton } from './IconButton';
import { Menu } from './Menu';

/** A palette dot shaped for Menu's `icon` slot. */
const dotIcon = (color: string, selected: boolean) =>
  function Dot({ className }: { className?: string }) {
    return (
      <span
        className={cn(
          'h-3.5 w-3.5 rounded-full',
          swatch(color).dot,
          // The selected colour is marked on the swatch itself. Putting a tick
          // in Menu's shortcut slot said "keyboard shortcut" in the faintest
          // ink on the surface — the wrong slot and the wrong weight for state.
          selected && 'ring-2 ring-ink ring-offset-1 ring-offset-canvas',
          className,
        )}
      />
    );
  };

const colorItems = (current: string, onPick: (c: TagColor) => void) =>
  TAG_COLORS.map((c) => ({
    icon: dotIcon(c, c === current),
    label: c[0].toUpperCase() + c.slice(1),
    onSelect: () => onPick(c),
  }));

/**
 * The colour swatch that opens the palette.
 *
 * Shared so a task type, a select option and anything else tinted from the tag
 * palette offer the same control. It used to live inside TaskKindsDialog, which
 * is why select options had no picker at all and were minted grey forever.
 */
export function ColorPicker({ color, label, side, onPick }: {
  color: string;
  label: string;
  side?: 'top' | 'bottom';
  onPick: (c: TagColor) => void;
}) {
  return (
    <Menu
      align="start"
      side={side}
      width={168}
      trigger={
        <IconButton
          label={label}
          icon={<span className={cn('h-3.5 w-3.5 rounded-full', swatch(color).dot)} />}
        />
      }
      items={colorItems(color, onPick)}
    />
  );
}
