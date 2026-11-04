import { ChevronsUpDown, CornerDownRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { DiffBlock, DiffWord, VersionDiff } from '../../lib/docsApi';
import { cn } from '../../lib/cn';

/**
 * A version diff, painted from the rows the server worked out
 * (server/src/version-diff.js). It borrows the inline-suggestion marks —
 * green underline in, red strike out, the gutter bar on a block — so a change
 * in History reads the same as a change someone suggested on the page.
 */

/** Unchanged runs longer than this fold away, a block of context kept each side. */
const FOLD_AT = 4;

const OP_VERB: Record<DiffBlock['op'], string> = {
  same: '', added: 'added', removed: 'removed', changed: 'changed', moved: 'moved',
};
const SUGG_BAR: Partial<Record<DiffBlock['op'], string>> = { added: 'add', removed: 'remove', changed: 'type', moved: 'type' };

const HEADING: Record<string, string> = {
  h1: 'text-2xl font-semibold', h2: 'text-xl font-semibold', h3: 'text-lg font-semibold',
  h4: 'text-base font-semibold', h5: 'text-sm font-semibold', h6: 'text-sm font-semibold text-muted',
};

/** "Heading 1", "To-do", … — said when a block was retyped. */
function shapeName(s: { flavour: string; type: string | null; checked: boolean }) {
  if (s.flavour === 'affine:code') return 'Code';
  if (s.flavour === 'affine:list') {
    if (s.type === 'todo') return s.checked ? 'Done to-do' : 'To-do';
    return s.type === 'numbered' ? 'Numbered list' : 'Bulleted list';
  }
  if (s.type && /^h[1-6]$/.test(s.type)) return `Heading ${s.type.slice(1)}`;
  return s.type === 'quote' ? 'Quote' : 'Text';
}

function Words({ words }: { words: DiffWord[] }) {
  return (
    <>
      {words.map((w, i) =>
        w.op === 'eq' ? <span key={i}>{w.text}</span>
          : <span key={i} className={w.op === 'ins' ? 'mn-sugg-ins' : 'mn-sugg-del'}>{w.text}</span>,
      )}
    </>
  );
}

function Marker({ b }: { b: DiffBlock }) {
  if (b.flavour !== 'affine:list') return null;
  const box = b.type === 'todo';
  return (
    <span aria-hidden className="mr-2 inline-block w-4 shrink-0 select-none text-center text-muted">
      {box ? (b.checked ? '☑' : '☐') : b.type === 'numbered' ? '#' : '•'}
    </span>
  );
}

function Block({ b }: { b: DiffBlock }) {
  const bar = SUGG_BAR[b.op];
  const note = b.op === 'moved' ? 'Moved here' : b.was ? `Was ${shapeName(b.was)}` : null;

  if (b.label !== undefined) {
    // A non-text block is one row: what it is and what happened to it.
    return (
      <div data-mn-sugg={bar} className="my-1 rounded-md">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-sm',
            b.op === 'added' && 'mn-sugg-ins',
            b.op === 'removed' && 'mn-sugg-del',
          )}
        >
          {b.label}{b.op === 'same' ? '' : ` ${OP_VERB[b.op]}`}
        </span>
      </div>
    );
  }

  const content: ReactNode = b.words ? <Words words={b.words} />
    : b.op === 'added' ? <span className="mn-sugg-ins">{b.text}</span>
    : b.op === 'removed' ? <span className="mn-sugg-del">{b.text}</span>
    : b.text;
  const code = b.flavour === 'affine:code';
  return (
    <div data-mn-sugg={bar} className="py-0.5">
      {note && (
        <span className="mb-0.5 flex items-center gap-1 text-2xs text-faint">
          {b.op === 'moved' && <CornerDownRight size={11} />} {note}
        </span>
      )}
      <div
        className={cn(
          'flex min-h-[1.5em] whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink',
          b.type && HEADING[b.type],
          b.type === 'quote' && 'border-l-2 border-line pl-3 text-muted',
          code && 'rounded-md bg-surface px-3 py-2 font-mono text-sm',
        )}
      >
        <Marker b={b} />
        <span className="min-w-0 flex-1">{content}</span>
      </div>
    </div>
  );
}

type Row = { kind: 'block'; b: DiffBlock } | { kind: 'fold'; key: string; hidden: DiffBlock[] };

/** The diff's rows with long unchanged runs folded, except the ones opened. */
function foldRows(blocks: DiffBlock[], open: Set<string>): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < blocks.length;) {
    if (blocks[i].op !== 'same') { rows.push({ kind: 'block', b: blocks[i++] }); continue; }
    let j = i;
    while (j < blocks.length && blocks[j].op === 'same') j++;
    // One block of context beside a change; none at the page's very ends.
    const keepHead = i > 0 ? 1 : 0, keepTail = j < blocks.length ? 1 : 0;
    const key = blocks[i].id;
    const hidden = j - i - keepHead - keepTail;
    if (hidden < FOLD_AT || open.has(key)) {
      for (let k = i; k < j; k++) rows.push({ kind: 'block', b: blocks[k] });
    } else {
      for (let k = i; k < i + keepHead; k++) rows.push({ kind: 'block', b: blocks[k] });
      rows.push({ kind: 'fold', key, hidden: blocks.slice(i + keepHead, j - keepTail) });
      for (let k = j - keepTail; k < j; k++) rows.push({ kind: 'block', b: blocks[k] });
    }
    i = j;
  }
  return rows;
}

/** "+3 −1 blocks · 2 edited · 1 moved" — or null when nothing changed. */
export function DiffStats({ stats }: { stats: VersionDiff['stats'] }) {
  const { added, removed, changed, moved } = stats;
  if (!added && !removed && !changed && !moved) return <span className="text-2xs text-faint">No changes</span>;
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-2xs tabular-nums text-muted">
      <span style={{ color: 'var(--sugg-ins-fg)' }}>+{added}</span>
      <span style={{ color: 'var(--sugg-del-fg)' }}>−{removed}</span>
      <span>blocks</span>
      {changed > 0 && <span>· {changed} edited</span>}
      {moved > 0 && <span>· {moved} moved</span>}
    </span>
  );
}

export function VersionDiffView({ diff, pageTitle }: { diff: VersionDiff; pageTitle: string }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const rows = foldRows(diff.blocks, open);
  const nothing = !diff.title && diff.blocks.every((b) => b.op === 'same');

  return (
    <div className="mx-auto max-w-[720px] px-6 pb-16 pt-6 md:px-10">
      <h1 data-mn-sugg={diff.title ? 'type' : undefined} className="mb-4 whitespace-pre-wrap text-3xl font-bold text-ink">
        {diff.title ? <Words words={diff.title} /> : pageTitle || 'Untitled'}
      </h1>
      {nothing && (
        <p className="mb-4 rounded-md bg-surface px-3 py-2 text-sm text-muted">
          {diff.against === 'current' ? 'The page is the same now as in this version.' : 'This save changed nothing on the page.'}
        </p>
      )}
      {rows.map((r) =>
        r.kind === 'block' ? (
          <Block key={`${r.b.op}:${r.b.id}`} b={r.b} />
        ) : (
          <button
            key={`fold:${r.key}`}
            type="button"
            onClick={() => setOpen((s) => new Set(s).add(r.key))}
            className="my-1.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-line py-1 text-2xs text-faint transition-colors duration-120 hover:bg-hover hover:text-ink"
          >
            <ChevronsUpDown size={12} />
            {r.hidden.length} unchanged blocks
          </button>
        ),
      )}
    </div>
  );
}
