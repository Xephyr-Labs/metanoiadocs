import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import type { KeyboardEventHandler, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { IconButton } from './IconButton';

/** One entry/exit for every dialog in the app — top surfaces drop in, centered
 * surfaces rise. Overlay always cross-fades. Keep these numbers here, not at
 * the call sites, or the dialogs drift apart again. */
const OVERLAY = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } };
const EASE = [0.16, 1, 0.3, 1] as const;
const panelMotion = (placement: 'center' | 'top') => {
  const hidden = { opacity: 0, scale: 0.98, y: placement === 'top' ? -8 : 8 };
  return { initial: hidden, animate: { opacity: 1, scale: 1, y: 0 }, exit: hidden };
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name. Rendered as a bordered header unless `bare`. */
  title: ReactNode;
  /** Drop the header chrome — the title becomes screen-reader-only (⌘K, Settings). */
  bare?: boolean;
  /** `top` anchors below the viewport top (search-like); `center` centers. */
  placement?: 'center' | 'top';
  /** Panel width in px, capped at 92vw. Overridden by a `w-*` class in `className`. */
  width?: number;
  /** Rise from the bottom edge on phones (task detail). */
  sheet?: boolean;
  /** Extra classes on the panel — max-height, flex direction, responsive shape. */
  className?: string;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  children: ReactNode;
}

export function Modal({
  open,
  onOpenChange,
  title,
  bare,
  placement = 'center',
  width = 460,
  sheet,
  className,
  onKeyDown,
  children,
}: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                {...OVERLAY}
                transition={{ duration: 0.12 }}
                className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]"
              />
            </Dialog.Overlay>
            <Dialog.Content asChild aria-describedby={undefined} onKeyDown={onKeyDown}>
              <div
                onClick={(e) => e.target === e.currentTarget && onOpenChange(false)}
                className={cn(
                  'fixed inset-0 z-50 flex justify-center',
                  // Padding first — tailwind-merge lets the later pt-[12vh] win.
                  sheet ? 'items-end p-0 sm:items-center sm:p-4' : 'items-center p-4',
                  placement === 'top' && 'items-start pt-[12vh]',
                )}
              >
                <motion.div
                  {...panelMotion(placement)}
                  transition={{ duration: 0.16, ease: EASE }}
                  style={{ maxWidth: `min(92vw, ${width}px)` }}
                  className={cn(
                    'pointer-events-auto flex w-full flex-col overflow-hidden border border-line bg-canvas shadow-modal',
                    sheet ? 'max-h-[88dvh] rounded-t-2xl sm:rounded-xl' : 'rounded-xl',
                    className,
                  )}
                >
                  {bare ? (
                    <Dialog.Title className="sr-only">{title}</Dialog.Title>
                  ) : (
                    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-3">
                      <Dialog.Title className="flex min-w-0 items-center gap-2 text-md font-semibold text-ink">
                        {title}
                      </Dialog.Title>
                      <IconButton
                        icon={<X size={16} />}
                        label="Close"
                        onClick={() => onOpenChange(false)}
                      />
                    </div>
                  )}
                  {children}
                </motion.div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

/** Scrolling list body — the shape four of the five dialogs share. */
export function ModalBody({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('scrollarea min-h-0 flex-1 overflow-y-auto p-2', className)}>{children}</div>
  );
}
