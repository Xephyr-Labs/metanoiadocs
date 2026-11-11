import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'framer-motion';
import { useRef, type ReactNode } from 'react';

/** Phone navigation/panel drawer. Radix owns the focus trap, Escape, background
 *  isolation; we put focus back where it was. */
export function SideDrawer({ open, onOpenChange, title, side, children }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string;
  side: 'left' | 'right'; children: ReactNode;
}) {
  const off = side === 'left' ? '-100%' : '100%';
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40 bg-overlay backdrop-blur-[1px]"
              />
            </Dialog.Overlay>
            <Dialog.Content
              asChild
              aria-describedby={undefined}
              // Focus the drawer itself, not its first control: on a phone that
              // would open the keyboard or a focus tooltip over the content.
              onOpenAutoFocus={(e) => {
                opener.current = document.activeElement as HTMLElement | null;
                e.preventDefault();
                (e.currentTarget as HTMLElement).focus({ preventScroll: true });
              }}
              // Radix only hands focus back to a Dialog.Trigger, and these are
              // opened from elsewhere (menu button, editor), so do it here.
              onCloseAutoFocus={(e) => {
                e.preventDefault();
                if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
              }}
            >
              <motion.div
                initial={{ x: off }}
                animate={{ x: 0 }}
                exit={{ x: off }}
                transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                tabIndex={-1}
                // Left: 300, not 280 — the drawer holds the same rail as the inline
                // sidebar, and a 72px rail inside 280 left the tree 208px. Capped
                // against the viewport so a 320px phone still shows the backdrop.
                className={`fixed top-0 z-50 h-full bg-canvas shadow-modal outline-none ${side === 'left' ? 'left-0 w-[300px] max-w-[88vw]' : 'right-0 w-full max-w-[420px] border-l border-line'}`}
              >
                <Dialog.Title className="sr-only">{title}</Dialog.Title>
                {children}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
