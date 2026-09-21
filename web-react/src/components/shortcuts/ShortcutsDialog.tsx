/* Hallmark · component: keyboard shortcut sheet · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: default · hover (row) · focus (panel, then close) · scrolled ·
 *         narrow (one column) · wide (two columns)
 * note: read-only. No control to press, so the eight interactive states
 *       collapse to the panel's own — the dialog is the component.
 */
import { Fragment } from 'react';
import { SHORTCUTS } from '../../lib/hotkeys';
import { Kbd } from '../ui/Kbd';
import { Modal } from '../ui/Modal';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Every shortcut the app has, on one sheet, opened with `?`.
 *
 * Rendered from lib/hotkeys' own list rather than a second copy written by
 * hand: a shortcut sheet that has drifted from the keys is worse than none,
 * because it is read once and believed afterwards.
 *
 * Two columns from `sm` up, one below it. Groups are short — four or five rows
 * each — so a column break inside one would be more confusing than the extra
 * scroll; `break-inside-avoid` keeps them whole.
 */
export function ShortcutsDialog({ open, onOpenChange }: Props) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Keyboard shortcuts"
      width={620}
      className="max-h-[80vh]"
      focusPanel
    >
      <div className="scrollarea overflow-y-auto px-4 py-3.5 sm:columns-2 sm:gap-6">
        {SHORTCUTS.map((group) => (
          <section key={group.title} className="mb-4 break-inside-avoid last:mb-0">
            <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">{group.title}</h3>
            <dl className="flex flex-col gap-0.5">
              {group.rows.map((row) => (
                <div key={row.label} className="flex items-baseline gap-3 rounded px-1 py-1 hover:bg-hover">
                  <dt className="flex shrink-0 items-center gap-1">
                    {row.keys.map((k, i) => (
                      <Fragment key={k}>
                        {/* A chord is two presses in a row, not two keys at
                            once, and "then" is the only honest way to draw
                            that — a plus sign would be a lie about `g h`. */}
                        {i > 0 && row.chord && <span className="text-3xs text-faint">then</span>}
                        <Kbd>{k}</Kbd>
                      </Fragment>
                    ))}
                  </dt>
                  <dd className="min-w-0 flex-1 text-2xs leading-4 text-muted">{row.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
