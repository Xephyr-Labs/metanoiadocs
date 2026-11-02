// Pending suggestions on a live page: list them, accept or reject them.
//
// The same semantics as server/src/inline-suggest.js (ruling R1: two runtimes,
// one set of cases, mirrored in model.test.ts), but every write goes through
// BlockSuite's Text and Store so the open editor stays in step with its models.
//
// Block suggestions live in `prop:mnSugg`, which the schema does not declare:
// the props proxy would drop it, so it is read from and deleted on the Y block
// directly, as textSize.ts does.
import { Text } from '@blocksuite/affine/store';

export type Verdict = 'accept' | 'reject';

export interface SuggestionCard {
  id: string;
  by: string;
  at: number;
  via?: 'ai';
  /** The first block the suggestion touches, in page order. */
  blockId: string;
  /** Every block it touches. */
  blockIds: string[];
  kind: 'insert' | 'delete' | 'replace' | 'add' | 'remove' | 'type';
  before: string;
  after: string;
  /** Block suggestions: the block's flavour and type now. */
  flavour?: string;
  type?: string;
}

interface Sugg { id: string; kind: string; by: string; at: number; via?: 'ai'; from?: { flavour: string; type?: string } }
interface YBlock { get(k: string): unknown; delete(k: string): void }
interface Model {
  id: string;
  flavour: string;
  children: Model[];
  text?: Text;
  yBlock?: YBlock;
  props?: { type?: string; mnSugg?: Sugg };
  parent?: Model | null;
}
// Loose on purpose: BlockSuite's Store is generic over every block schema.
export interface StoreLike {
  root: unknown;
  transact(fn: () => void): void;
  deleteBlock(model: never): void;
  updateBlock(model: never, props: never): void;
  addBlock(flavour: string, props: never, parent?: never, index?: number): string;
  getBlock(id: string): { model: unknown } | null | undefined;
  moveBlocks?(models: never[], parent: never): void;
  captureSync?(): void;
}

const KEY = 'mnSugg';
const BLOCK_KEY = 'prop:mnSugg';

const blockSugg = (m: Model): Sugg | undefined =>
  (m.yBlock?.get(BLOCK_KEY) ?? m.props?.mnSugg) as Sugg | undefined;

function ordered(store: StoreLike): Model[] {
  const out: Model[] = [];
  const walk = (m: Model | null | undefined) => {
    if (!m) return;
    out.push(m);
    for (const c of m.children ?? []) walk(c);
  };
  walk(store.root as Model | null);
  return out;
}

function runsOf(text: Text | undefined) {
  const runs: { at: number; len: number; s: Sugg; text: string }[] = [];
  if (!text) return runs;
  let at = 0;
  for (const op of text.yText.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[]) {
    const len = typeof op.insert === 'string' ? op.insert.length : 1;
    const s = op.attributes?.[KEY] as Sugg | undefined;
    if (s && typeof op.insert === 'string') runs.push({ at, len, s, text: op.insert });
    at += len;
  }
  return runs;
}

export function listSuggestions(store: StoreLike): SuggestionCard[] {
  const cards = new Map<string, SuggestionCard>();
  const card = (s: Sugg, blockId: string, kind: SuggestionCard['kind']) => {
    let c = cards.get(s.id);
    if (!c) {
      c = { id: s.id, by: s.by, at: s.at, blockId, blockIds: [], kind, before: '', after: '' };
      cards.set(s.id, c);
    }
    if (!c.blockIds.includes(blockId)) c.blockIds.push(blockId);
    if (s.via) c.via = s.via;
    return c;
  };
  for (const m of ordered(store)) {
    for (const { s, text } of runsOf(m.text)) {
      const c = card(s, m.id, s.kind === 'del' ? 'delete' : 'insert');
      if (s.kind === 'del') c.before += text; else c.after += text;
      if ((s.kind === 'del' && c.after) || (s.kind === 'ins' && c.before)) c.kind = 'replace';
    }
    const bs = blockSugg(m);
    if (!bs?.id) continue;
    const c = card(bs, m.id, bs.kind as SuggestionCard['kind']);
    c.flavour = m.flavour;
    c.type = m.props?.type;
    const here = m.text ? m.text.toString() : '';
    if (bs.kind === 'add') c.after = here;
    else if (bs.kind === 'remove') c.before = here;
    else {
      c.before = bs.from?.type ?? bs.from?.flavour ?? '';
      c.after = m.props?.type ?? m.flavour ?? '';
    }
  }
  return [...cards.values()];
}

function assertVerdict(v: unknown): asserts v is Verdict {
  if (v !== 'accept' && v !== 'reject') throw new Error(`Unknown verdict: ${String(v)}`);
}

/** Put a block back to the flavour and type it had before a `type` suggestion. */
function restoreType(store: StoreLike, m: Model, from: { flavour: string; type?: string }) {
  if (from.flavour === m.flavour) {
    if (from.type !== undefined) store.updateBlock(m as never, { type: from.type } as never);
    return;
  }
  // A flavour can't change in place: a new block of the old flavour takes this
  // one's place, text and children.
  const parent = m.parent;
  if (!parent) return;
  const props: Record<string, unknown> = { text: new Text((m.text?.yText.toDelta() ?? []) as never) };
  if (from.type !== undefined) props.type = from.type;
  const id = store.addBlock(from.flavour, props as never, parent as never, parent.children.indexOf(m));
  const fresh = store.getBlock(id)?.model;
  if (fresh && m.children.length) store.moveBlocks?.(m.children as never[], fresh as never);
  store.deleteBlock(m as never);
}

/** Accept or reject the suggestion `id`. True if anything changed. */
export function decide(store: StoreLike, id: string, verdict: Verdict): boolean {
  assertVerdict(verdict);
  const accept = verdict === 'accept';
  let changed = false;
  store.captureSync?.();
  store.transact(() => {
    for (const m of ordered(store)) {
      if (!store.getBlock(m.id)) continue; // went with a parent removed earlier in this pass
      for (const { at, len, s } of runsOf(m.text).filter((r) => r.s.id === id).reverse()) {
        if ((s.kind === 'ins') === accept) m.text!.format(at, len, { [KEY]: null });
        else m.text!.delete(at, len);
        changed = true;
      }
      const bs = blockSugg(m);
      if (bs?.id !== id) continue;
      changed = true;
      m.yBlock?.delete(BLOCK_KEY);
      if (bs.kind === 'add' ? !accept : bs.kind === 'remove' ? accept : false) store.deleteBlock(m as never);
      else if (bs.kind === 'type' && !accept && bs.from) restoreType(store, m, bs.from);
    }
  });
  return changed;
}

/** Decide every suggestion (or only `by`'s). The number decided. */
export function decideAll(store: StoreLike, verdict: Verdict, { by }: { by?: string } = {}): number {
  assertVerdict(verdict);
  let n = 0;
  store.transact(() => {
    for (const c of listSuggestions(store)) {
      if (by && c.by !== by) continue;
      if (decide(store, c.id, verdict)) n++;
    }
  });
  return n;
}

const clip = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 40 ? `${t.slice(0, 39)}…` : t;
};

const TYPE_LABEL: Record<string, string> = {
  text: 'Text', quote: 'Quote', bulleted: 'Bulleted list', numbered: 'Numbered list',
  todo: 'To-do', toggle: 'Toggle list', 'affine:code': 'Code', 'affine:paragraph': 'Text',
};
const typeLabel = (t: string) => (/^h[1-6]$/.test(t) ? `Heading ${t[1]}` : TYPE_LABEL[t] ?? t.replace(/^affine:/, ''));

function blockNoun(c: SuggestionCard): string {
  if (c.flavour === 'affine:paragraph') return /^h[1-6]$/.test(c.type ?? '') ? 'heading' : c.type === 'quote' ? 'quote' : 'paragraph';
  if (c.flavour === 'affine:list') return 'list item';
  if (c.flavour === 'affine:code') return 'code block';
  if (c.flavour === 'affine:image') return 'image';
  return 'block';
}

/** What the card says: `Replace "20 October" with "27 October"`, `Add paragraph`. */
export function describeCard(c: SuggestionCard): string {
  switch (c.kind) {
    case 'replace': return `Replace "${clip(c.before)}" with "${clip(c.after)}"`;
    case 'insert': return `Add "${clip(c.after)}"`;
    case 'delete': return `Delete "${clip(c.before)}"`;
    case 'add': return `Add ${blockNoun(c)}`;
    case 'remove': return `Remove ${blockNoun(c)}`;
    case 'type': return `Changed to ${typeLabel(c.after)}`;
  }
}
