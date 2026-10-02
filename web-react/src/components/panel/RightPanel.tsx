import { AnimatePresence, motion } from 'framer-motion';
import { Bot, Info, ListTree, MessageSquareText, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { onCommentRequest } from '../../editor/comments';
import { CommentsTab } from './CommentsTab';
import { AIChat } from './AIChat';
import { IntelligenceRail } from '../intelligence/IntelligenceRail';
import { useIntelligence } from '../../hooks/useIntelligence';
import { useDocSaveTick } from '../../lib/docSignal';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { relativeTime } from '../../lib/time';
import { useWorkspace, type RightTab } from '../../store/workspace';
import { cn } from '../../lib/cn';
import { EmptyState } from '../ui/EmptyState';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';

const TABS: { id: RightTab; label: string; icon: typeof Info }[] = [
  { id: 'intel', label: 'Intelligence', icon: Sparkles },
  { id: 'comments', label: 'Comments', icon: MessageSquareText },
  { id: 'outline', label: 'Outline', icon: ListTree },
  { id: 'details', label: 'Details', icon: Info },
  { id: 'ai', label: 'AI', icon: Bot },
];

export function RightPanel() {
  const ws = useWorkspace();
  const open = ws.rightPanel !== null;
  const isMobile = useMediaQuery('(max-width: 767px)');

  // The editor's floating "Comment" button lands here: open the comments tab.
  useEffect(() => onCommentRequest(() => ws.setRightPanel('comments')), [ws]);

  return (
    <AnimatePresence>
      {open && isMobile && (
        <motion.div
          key="rp-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => ws.setRightPanel(null)}
          className="fixed inset-0 z-40 bg-overlay backdrop-blur-[1px]"
        />
      )}
      {open && isMobile && (
        <motion.aside
          key="rp-mobile"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="fixed right-0 top-0 z-50 h-full w-full max-w-[420px] border-l border-line bg-canvas shadow-modal"
        >
          <PanelInner />
        </motion.aside>
      )}
      {open && !isMobile && (
        <motion.aside
          key="rp-desktop"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: ws.rightPanel === 'ai' ? 400 : 320, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="relative h-full shrink-0 overflow-hidden border-l border-line bg-canvas"
        >
          <PanelInner />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function PanelInner() {
  const scrolledTab = useRef<string | null>(null);
  const ws = useWorkspace();
  const docId = ws.currentId;
  return (
    <div className={cn('flex h-full w-full flex-col', ws.rightPanel === 'ai' ? 'md:w-[400px]' : 'md:w-[320px]')}>
      <div className="flex h-[45px] shrink-0 items-center gap-0.5 border-b border-line px-2">
        <div className="no-scrollbar flex flex-1 items-center gap-0.5 overflow-x-auto">
          {TABS.map((t) => (
            <Tooltip key={t.id} label={t.label}>
            <button
              type="button"
              // Keep the active tab visible — five tabs overflow the 320px strip.
              // Only when the active tab changes: on every render it scrolled the
              // sheet and pushed a focused comment box out from above the keyboard.
              ref={(el) => {
                if (ws.rightPanel !== t.id || !el || scrolledTab.current === t.id) return;
                scrolledTab.current = t.id;
                el.scrollIntoView({ inline: 'nearest', block: 'nearest' });
              }}
              onClick={() => ws.setRightPanel(t.id)}
              aria-label={t.label}
              className={cn('flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium transition-colors duration-120', ws.rightPanel === t.id ? 'bg-hover text-ink' : 'text-muted hover:bg-hover')}
            >
              <t.icon size={14} />
              {/* Only the active tab is worth its label: six labels do not fit a
                  320px rail, and truncating them ("Outli…") is worse than an
                  icon with a tooltip. The tooltip is the app's own, not the
                  browser's — a native title= here was the only OS-styled
                  tooltip in a UI that uses Radix everywhere else. */}
              {ws.rightPanel === t.id && <span>{t.label}</span>}
            </button>
            </Tooltip>
          ))}
        </div>
        <IconButton icon={<X size={16} />} label="Close" onClick={() => ws.setRightPanel(null)} />
      </div>

      {ws.rightPanel === 'ai' ? (
        <div className="min-h-0 flex-1"><AIChat /></div>
      ) : (
      <div className="scrollarea min-h-0 flex-1 overflow-y-auto">
        {!docId ? (
          <EmptyState icon={Info} title="No page open" />
        ) : ws.rightPanel === 'intel' ? (
          <IntelligenceTab docId={docId} />
        ) : ws.rightPanel === 'comments' ? (
          <CommentsTab key={docId} docId={docId} />
        ) : ws.rightPanel === 'outline' ? (
          <OutlineTab />
        ) : ws.rightPanel === 'details' ? (
          <DetailsTab />
        ) : null}
      </div>
      )}
    </div>
  );
}

/** Fetches on doc change and on each editor save, so signals stay in step. */
function IntelligenceTab({ docId }: { docId: string }) {
  const intel = useIntelligence(docId, useDocSaveTick());
  return <IntelligenceRail data={intel.data} loading={intel.loading} error={intel.error} />;
}

function OutlineTab() {
  const [items, setItems] = useState<{ level: number; text: string }[]>([]);
  useEffect(() => {
    const scan = () => {
      const host = document.querySelector('affine-editor-container');
      if (!host) return;
      const out: { level: number; text: string }[] = [];
      // BlockSuite marks the heading level as a class (h1…h6) on the paragraph's
      // rich-text wrapper — there is no data-type attribute to read.
      host.querySelectorAll('affine-paragraph').forEach((el) => {
        const wrapper = el.querySelector('.affine-paragraph-rich-text-wrapper');
        const lvl = Number(wrapper?.className.match(/\bh([1-6])\b/)?.[1] || 0);
        const text = (el as HTMLElement).innerText.trim();
        if (lvl >= 1 && lvl <= 3 && text) out.push({ level: lvl, text });
      });
      setItems(out);
    };
    scan();
    const t = setInterval(scan, 1500);
    return () => clearInterval(t);
  }, []);

  if (items.length === 0) return <EmptyState icon={ListTree} title="No headings yet" hint="Add H1–H3 headings to build an outline." compact />;
  return (
    <nav className="p-2">
      {items.map((o, i) => (
        <div key={i} className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-muted" style={{ paddingLeft: 8 + (o.level - 1) * 14 }}>
          <span className="truncate">{o.text}</span>
        </div>
      ))}
    </nav>
  );
}

function DetailsTab() {
  const ws = useWorkspace();
  const p = ws.currentPage;
  if (!p) return null;
  const rows: [string, string][] = [
    ['Your role', p.role],
    ['Sharing', p.shared ? 'Public link on' : 'Private'],
    ['Created by', p.createdByName ?? 'Unknown'],
    ['Created', p.createdAt ? relativeTime(p.createdAt) : '—'],
    // Null until somebody saves it — a page nobody has touched since it was
    // made has no last editor, and saying "Unknown" there would be a lie.
    ['Last edited by', p.updatedByName ?? 'Not edited yet'],
    ['Last edited', relativeTime(p.updatedAt)],
    ['Loves', String(p.loveCount)],
    ['Sub-pages', String(p.children.length)],
  ];
  return (
    <dl className="divide-y divide-line p-1">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between px-2 py-2.5 text-sm">
          <dt className="text-muted">{k}</dt>
          <dd className="font-medium text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
