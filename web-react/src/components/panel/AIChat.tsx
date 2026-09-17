import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUp,
  Check,
  Copy,
  FileText,
  Files,
  FilePlus2,
  Folder,
  FolderInput,
  Globe,
  Link2,
  Loader2,
  MessageSquareText,
  PenLine,
  Plus,
  Search,
  Share2,
  Sparkles,
  Square,
  Tag,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { aiStream, type AiToolStep } from '../../lib/docsApi';
import { copyText } from '../../lib/clipboard';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/cn';
import { useWorkspace } from '../../store/workspace';
import { Markdown } from '../ui/Markdown';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  /** What the copilot did before answering. Assistant turns only. */
  steps?: AiToolStep[];
}

/**
 * How each tool reads in the activity line. The copilot's tools are the MCP
 * surface, so this table is keyed by MCP tool name — a tool with no entry
 * still shows, under its own name, rather than vanishing.
 */
const TOOL_UI: Record<string, { icon: typeof Search; running: string; done: string; quote?: boolean }> = {
  search_docs: { icon: Search, running: 'Searching for', done: 'Searched for', quote: true },
  list_docs: { icon: Files, running: 'Listing pages', done: 'Listed pages' },
  read_doc: { icon: FileText, running: 'Reading a page', done: 'Read' },
  create_doc: { icon: FilePlus2, running: 'Creating', done: 'Created' },
  write_doc: { icon: PenLine, running: 'Editing a page', done: 'Edited' },
  comment_on_doc: { icon: MessageSquareText, running: 'Commenting', done: 'Commented on' },
  set_visibility: { icon: Globe, running: 'Changing visibility to', done: 'Visibility set to' },
  add_tag: { icon: Tag, running: 'Tagging with', done: 'Tagged with' },
  list_members: { icon: Users, running: 'Checking members', done: 'Checked members' },
  list_folders: { icon: Folder, running: 'Listing folders', done: 'Listed folders' },
  move_doc: { icon: FolderInput, running: 'Moving a page', done: 'Moved' },
  link_docs: { icon: Link2, running: 'Linking pages', done: 'Linked' },
  share_doc: { icon: Share2, running: 'Sharing with', done: 'Shared with' },
};

/**
 * Tools that change something. When the copilot has used one, the sidebar,
 * tag list and page header are all out of date — the answer says "tagged" and
 * the page still shows the old tags until something reloads them.
 */
const MUTATING = new Set([
  'create_doc',
  'write_doc',
  'comment_on_doc',
  'set_visibility',
  'add_tag',
  'move_doc',
  'link_docs',
  'share_doc',
]);

function stepLabel(s: AiToolStep): string {
  const ui = TOOL_UI[s.name];
  if (!ui) return s.name.replace(/_/g, ' ');
  const verb = s.done ? ui.done : ui.running;
  if (!s.hint) return verb;
  return `${verb} ${ui.quote ? `“${s.hint}”` : s.hint}`;
}

function ToolSteps({ steps }: { steps: AiToolStep[] }) {
  return (
    <div className="space-y-1">
      {steps.map((s) => {
        const Icon = TOOL_UI[s.name]?.icon ?? Sparkles;
        return (
          <div key={s.i} className="flex items-center gap-1.5 text-2xs text-muted">
            {s.done ? (
              <Icon size={12} className="shrink-0 text-faint" />
            ) : (
              <Loader2 size={12} className="shrink-0 animate-spin text-faint" />
            )}
            <span className="truncate">{stepLabel(s)}</span>
            {s.error && <span className="shrink-0 text-danger-strong">· failed</span>}
          </div>
        );
      })}
    </div>
  );
}

/** The page the question is about, shown the way it is attached: as a chip. */
function ContextChip({ icon, title, onRemove }: { icon: string; title: string; onRemove: () => void }) {
  return (
    <span className="group/chip inline-flex h-6 max-w-full items-center gap-1.5 rounded-md bg-surface pl-1.5 pr-1 text-2xs text-ink ring-1 ring-inset ring-line">
      <span className="shrink-0 text-3xs leading-none">{icon || '📄'}</span>
      <span className="min-w-0 truncate">{title || 'Untitled'}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove this page from the chat"
        className="shrink-0 rounded p-0.5 text-faint transition-colors hover:bg-hover hover:text-ink"
      >
        <X size={12} />
      </button>
    </span>
  );
}

function Answer({ m, streaming }: { m: Msg; streaming: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!(await copyText(m.content))) {
      toast('Could not copy — your browser blocked clipboard access');
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className="group/answer">
      {!!m.steps?.length && <ToolSteps steps={m.steps} />}
      {m.content ? (
        <Markdown text={m.content} className="mt-1.5 text-sm text-ink" />
      ) : (
        !m.steps?.length && <Thinking />
      )}
      {m.content && !streaming && (
        <button
          type="button"
          onClick={copy}
          className="mt-1.5 flex items-center gap-1 text-2xs text-faint opacity-0 transition-opacity duration-120 hover:text-ink focus-visible:opacity-100 group-hover/answer:opacity-100"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      )}
    </div>
  );
}

/** A model can be slow; silence for 20s reads as broken unless it counts. */
function Thinking() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center gap-1.5 text-2xs text-muted">
      <Loader2 size={12} className="animate-spin text-faint" />
      Thinking{secs > 2 ? ` · ${secs}s` : '…'}
    </div>
  );
}

export function AIChat() {
  const ws = useWorkspace();
  // Only a page you are actually looking at is attached. currentPage survives
  // navigating to Home or a board, and a chat that claims to have "this page"
  // open on the dashboard is lying about its own context.
  const page = ws.view === 'doc' ? ws.currentPage : null;
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [attached, setAttached] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const touched = useRef(false);

  // Opening a different page re-attaches it: the chat follows what you are
  // looking at, which is the whole point of attaching it in the first place.
  useEffect(() => setAttached(true), [page?.id]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages]);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Grow the composer with the draft, up to about six lines.
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 132)}px`;
  }, [input]);

  const docId = attached ? page?.id : undefined;

  const send = async (preset?: string) => {
    const text = (preset ?? input).trim();
    if (!text || busy) return;
    setErr(null);
    setInput('');
    const history = [...messages.map((m) => ({ role: m.role, content: m.content })), { role: 'user' as const, content: text }];
    setMessages([...messages, { role: 'user', content: text }, { role: 'assistant', content: '', steps: [] }]);
    setBusy(true);
    const ctl = new AbortController();
    abortRef.current = ctl;
    touched.current = false;

    const patchLast = (fn: (m: Msg) => Msg) =>
      setMessages((m) => (m.length ? [...m.slice(0, -1), fn(m[m.length - 1])] : m));

    try {
      await aiStream(
        { messages: history, docId },
        (delta) => patchLast((m) => ({ ...m, content: m.content + delta })),
        ctl.signal,
        (step) => {
          if (step.done && !step.error && MUTATING.has(step.name)) touched.current = true;
          patchLast((m) => {
            const steps = m.steps ?? [];
            const at = steps.findIndex((s) => s.i === step.i);
            return { ...m, steps: at === -1 ? [...steps, step] : steps.map((s) => (s.i === step.i ? step : s)) };
          });
        },
      );
    } catch (e) {
      // Stopping is a choice, not a failure: keep whatever had arrived.
      if (ctl.signal.aborted) {
        patchLast((m) => ({ ...m, content: m.content || '_Stopped._' }));
      } else {
        setErr(e instanceof Error ? e.message : 'AI error');
        setMessages((m) => m.slice(0, -1));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
      if (touched.current) {
        void ws.refresh();
        void ws.refreshTags();
      }
    }
  };

  const suggestions = page
    ? ['Summarise this page', 'What are the action items?', 'Find related pages']
    : ['What pages can I see?', 'Search for the launch plan', 'Draft a meeting agenda'];

  return (
    <div className="flex h-full flex-col">
      {messages.length > 0 && (
        <div className="flex shrink-0 items-center justify-end border-b border-line px-2 py-1.5">
          <button
            type="button"
            onClick={() => { abortRef.current?.abort(); setMessages([]); setErr(null); }}
            className="flex h-6 items-center gap-1 rounded-md px-1.5 text-2xs text-muted transition-colors hover:bg-hover hover:text-ink"
          >
            <Plus size={12} /> New chat
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {messages.length === 0 && !err && (
          <div className="pt-2">
            <Sparkles size={18} className="text-accent-strong" />
            <p className="mt-2 text-md font-semibold text-ink">
              {page && attached ? 'Chat with this page' : 'Ask AI'}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {page && attached
                ? 'It can read this page, search the workspace, and make changes you ask for.'
                : 'It can search the workspace, read pages, and make changes you ask for.'}
            </p>
            <div className="mt-3 flex flex-col items-start gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-md bg-surface px-2.5 py-1.5 text-left text-sm text-ink ring-1 ring-inset ring-line transition-colors duration-120 hover:bg-hover"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-xl rounded-br-sm bg-surface px-3 py-2 text-sm text-ink">
                {m.content}
              </p>
            </div>
          ) : (
            <Answer key={i} m={m} streaming={busy && i === messages.length - 1} />
          ),
        )}

        {err && <div className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-strong">{err}</div>}
        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t border-line p-2.5">
        <div className="rounded-xl bg-canvas ring-1 ring-inset ring-line transition-shadow focus-within:ring-2 focus-within:ring-accent">
          <AnimatePresence initial={false}>
            {page && attached && (
              <motion.div
                key="chip"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden px-2 pt-2"
              >
                <ContextChip icon={page.icon} title={page.title} onRemove={() => setAttached(false)} />
              </motion.div>
            )}
          </AnimatePresence>
          <div className="flex items-end gap-1 p-1.5">
            <textarea
              ref={taRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={page && attached ? 'Ask about this page…' : 'Ask AI anything…'}
              className="min-h-[28px] flex-1 resize-none bg-transparent px-1.5 py-1 text-sm leading-relaxed text-ink outline-none placeholder:text-faint"
            />
            {page && !attached && (
              <Tooltip label="Attach this page">
                <button
                  type="button"
                  onClick={() => setAttached(true)}
                  aria-label="Attach this page"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:bg-hover hover:text-ink"
                >
                  <FileText size={16} />
                </button>
              </Tooltip>
            )}
            {busy ? (
              <IconButton icon={<Square size={14} className="fill-current" />} label="Stop" onClick={() => abortRef.current?.abort()} />
            ) : (
              <button
                type="button"
                onClick={() => send()}
                disabled={!input.trim()}
                aria-label="Send"
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors duration-120',
                  input.trim() ? 'bg-accent-fill text-white hover:brightness-[0.94]' : 'bg-surface text-faint',
                )}
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
