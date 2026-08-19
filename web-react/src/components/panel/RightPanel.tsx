import { AnimatePresence, motion } from 'framer-motion';
import { Bot, Check, Info, ListTree, Loader2, MessageSquareText, Send, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { aiStream, docsApi, type CommentRow, type UserRow } from '../../lib/docsApi';
import { applyCommentHighlights, clearPendingAnchor, clearPendingFocus, onCommentRequest, usePendingAnchor, usePendingFocus } from '../../editor/comments';
import { IntelligenceRail } from '../intelligence/IntelligenceRail';
import { useIntelligence } from '../../hooks/useIntelligence';
import { useDocSaveTick } from '../../lib/docSignal';
import { useOutsideClick } from '../../hooks/useOutsideClick';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { avatarFor } from '../../lib/avatar';
import { relativeTime } from '../../lib/time';
import { useWorkspace, type RightTab } from '../../store/workspace';
import { cn } from '../../lib/cn';
import { Button } from '../ui/Button';
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

function Avatar({ name, size = 22 }: { name: string; size?: number }) {
  const a = avatarFor(name);
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: a.color, fontSize: size * 0.42 }}>
      {a.initials}
    </span>
  );
}

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
          animate={{ width: 320, opacity: 1 }}
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
  const ws = useWorkspace();
  const docId = ws.currentId;
  return (
    <div className="flex h-full w-full flex-col md:w-[320px]">
      <div className="flex h-[45px] shrink-0 items-center gap-0.5 border-b border-line px-2">
        <div className="no-scrollbar flex flex-1 items-center gap-0.5 overflow-x-auto">
          {TABS.map((t) => (
            <Tooltip key={t.id} label={t.label}>
            <button
              type="button"
              // Keep the active tab visible — five tabs overflow the 320px strip.
              ref={(el) => { if (ws.rightPanel === t.id) el?.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }}
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

      <div className="scrollarea min-h-0 flex-1 overflow-y-auto">
        {ws.rightPanel === 'ai' ? (
          // AI chat is not doc-scoped — it must work from Home too.
          <AITab />
        ) : !docId ? (
          <EmptyState icon={Info} title="No page open" />
        ) : ws.rightPanel === 'intel' ? (
          <IntelligenceTab docId={docId} />
        ) : ws.rightPanel === 'comments' ? (
          <CommentsTab docId={docId} />
        ) : ws.rightPanel === 'outline' ? (
          <OutlineTab />
        ) : ws.rightPanel === 'details' ? (
          <DetailsTab />
        ) : null}
      </div>
    </div>
  );
}

/** Fetches on doc change and on each editor save, so signals stay in step. */
function IntelligenceTab({ docId }: { docId: string }) {
  const intel = useIntelligence(docId, useDocSaveTick());
  return <IntelligenceRail data={intel.data} loading={intel.loading} error={intel.error} />;
}

function CommentsTab({ docId }: { docId: string }) {
  const [comments, setComments] = useState<CommentRow[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState<UserRow[]>([]);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const composerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const anchor = usePendingAnchor();
  const focusId = usePendingFocus();

  const load = () =>
    docsApi.comments(docId)
      .then((rows) => { setComments(rows); applyCommentHighlights(rows); })
      .catch(() => setComments([]));
  useEffect(() => { setComments(null); load(); /* eslint-disable-next-line */ }, [docId]);
  useEffect(() => { docsApi.users().then(setMembers).catch(() => {}); }, []);
  // Selection just landed here — put the caret in the composer. Delay past the
  // panel slide-in, which otherwise steals focus back.
  useEffect(() => {
    if (!anchor) return;
    const t = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, [anchor]);
  // A marked range was clicked in the doc — bring its card into view, flash it.
  useEffect(() => {
    if (!focusId || !comments) return;
    const el = cardRefs.current.get(focusId);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const t = setTimeout(clearPendingFocus, 1800);
    return () => clearTimeout(t);
  }, [focusId, comments]);

  // Active @-mention being typed: an "@" + word chars at the end of the draft.
  const mentionMatch = draft.match(/@([a-z0-9._-]*)$/i);
  const mentionQuery = mentionMatch ? mentionMatch[1].toLowerCase() : null;
  const suggestions = mentionQuery !== null && !mentionDismissed
    ? members
        .filter((m) => m.username && (m.username.toLowerCase().includes(mentionQuery) || (m.name || '').toLowerCase().includes(mentionQuery)))
        .slice(0, 6)
    : [];
  useOutsideClick(composerRef, useCallback(() => setMentionDismissed(true), []), suggestions.length > 0);

  const pickMention = (m: UserRow) => {
    setDraft((d) => d.replace(/@([a-z0-9._-]*)$/i, `@${m.username} `));
  };

  const add = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await docsApi.addComment(docId, body, anchor ? { blockId: anchor.blockId, quote: anchor.quote } : undefined);
      setDraft('');
      clearPendingAnchor();
      await load();
    } finally { setBusy(false); }
  };

  if (comments === null) return <div className="flex justify-center py-10"><Loader2 size={18} className="animate-spin text-faint" /></div>;

  const roots = comments.filter((c) => !c.parent_id);
  const replies = (id: string) => comments.filter((c) => c.parent_id === id);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 p-3">
        {roots.length === 0 && <EmptyState icon={MessageSquareText} title="No comments yet" hint="Add the first comment below." compact />}
        {roots.map((c) => (
          <div
            key={c.id}
            ref={(el) => { if (el) cardRefs.current.set(c.id, el); else cardRefs.current.delete(c.id); }}
            className={cn(
              'rounded-lg border border-line bg-comment p-3 transition-shadow duration-220',
              c.resolved && 'bg-transparent opacity-55',
              focusId === c.id && 'ring-2 ring-accent/60',
            )}
          >
            <div className="flex items-center gap-2">
              <Avatar name={c.author_name} />
              <span className="text-sm font-medium text-ink">{c.author_name}</span>
              <span className="text-2xs text-faint">{relativeTime(c.created_at)}</span>
              {c.resolved ? (
                <span className="ml-auto flex items-center gap-1 text-2xs text-faint"><Check size={12} /> Resolved</span>
              ) : (
                <button onClick={() => docsApi.resolveComment(c.id, true).then(load)} className="ml-auto text-2xs text-muted hover:text-ink">Resolve</button>
              )}
            </div>
            {c.quote && <p className="mt-1.5 border-l-2 border-comment-mark pl-2 text-2xs italic text-muted">{c.quote}</p>}
            <p className="mt-1.5 text-sm leading-relaxed text-ink">{c.body}</p>
            {replies(c.id).map((r) => (
              <div key={r.id} className="mt-2.5 flex items-start gap-2 border-l-2 border-line pl-2.5">
                <Avatar name={r.author_name} size={18} />
                <div>
                  <p className="text-2xs font-medium text-ink">{r.author_name} <span className="font-normal text-faint">· {relativeTime(r.created_at)}</span></p>
                  <p className="text-sm text-ink">{r.body}</p>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div ref={composerRef} className="relative border-t border-line p-3">
        {anchor && (
          <div className="mb-2 flex items-center gap-2 rounded-md bg-comment px-2.5 py-1.5">
            <span className="min-w-0 flex-1 truncate text-2xs italic text-muted">“{anchor.quote}”</span>
            <button type="button" onClick={clearPendingAnchor} aria-label="Remove quote" className="shrink-0 text-faint hover:text-ink">
              <X size={12} />
            </button>
          </div>
        )}
        {suggestions.length > 0 && (
          <div className="absolute bottom-[52px] left-3 right-3 z-10 overflow-hidden rounded-lg border border-line bg-canvas shadow-pop">
            {suggestions.map((m) => (
              <button
                key={m.id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pickMention(m); }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-hover"
              >
                <Avatar name={m.name || m.username || m.email} size={18} />
                <span className="font-medium text-ink">{m.name || m.username}</span>
                <span className="truncate text-2xs text-faint">@{m.username}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 rounded-md ring-1 ring-inset ring-line focus-within:ring-2 focus-within:ring-accent">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setMentionDismissed(false); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                // If the mention menu is open, Enter picks the top suggestion
                // instead of submitting a half-typed handle.
                if (suggestions.length > 0) { e.preventDefault(); pickMention(suggestions[0]); return; }
                add();
              }
            }}
            placeholder={anchor ? 'Comment on selection…' : 'Add a comment…  @ to mention'}
            className="h-9 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-faint"
          />
          <IconButton icon={busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} label="Send" onClick={add} className="mr-0.5" />
        </div>
      </div>
    </div>
  );
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
    ['Last edited', relativeTime(p.updatedAt)],
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

function AITab() {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setErr(null);
    setInput('');
    const history = [...messages, { role: 'user' as const, content: text }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setBusy(true);
    try {
      await aiStream({ messages: history }, (delta) => {
        setMessages((m) => {
          const next = [...m];
          next[next.length - 1] = { role: 'assistant', content: next[next.length - 1].content + delta };
          return next;
        });
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'AI error');
      setMessages((m) => m.slice(0, -1));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 p-3">
        {messages.length === 0 && !err && (
          <div className="flex items-center gap-2 rounded-lg bg-accent-soft p-3 text-sm text-ink">
            <Sparkles size={16} className="shrink-0 text-accent" />
            Ask AI to draft, summarize, or answer questions. Configure a provider in Settings.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn('rounded-lg px-3 py-2 text-sm leading-relaxed', m.role === 'user' ? 'bg-surface text-ink' : 'bg-accent-soft text-ink')}>
            {m.content || <Loader2 size={14} className="animate-spin text-accent" />}
          </div>
        ))}
        {err && <div className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>}
        <div ref={endRef} />
      </div>
      <div className="border-t border-line p-3">
        <div className="flex items-center gap-2 rounded-lg ring-1 ring-inset ring-line focus-within:ring-2 focus-within:ring-accent">
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Ask AI anything…" className="h-9 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-faint" />
          <Button size="sm" variant="primary" className="mr-1" onClick={send} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : 'Ask'}</Button>
        </div>
      </div>
    </div>
  );
}
