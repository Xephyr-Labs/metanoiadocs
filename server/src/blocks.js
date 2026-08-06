// Build a BlockSuite (0.22.4) Yjs doc state from markdown, entirely with plain
// yjs — no BlockSuite runtime. The block schema (flavours, versions, sys:/prop:
// keys, note defaults) mirrors what the editor produces natively, so a doc built
// here renders in the editor and syncs over Hocuspocus like any other.
import * as Y from 'yjs';
import crypto from 'node:crypto';

const blockId = () => crypto.randomBytes(8).toString('base64url').slice(0, 10);

// A page reference is one space carrying a `reference` attribute — BlockSuite's
// REFERENCE_NODE. `[[key]]` in the source markdown becomes one, via a resolver
// the caller supplies (the seed knows its own doc ids; nobody else passes one).
const REFERENCE_NODE = ' ';
const LINK_RE = /\[\[([^\]\n]+)\]\]/g;

/**
 * `pending` collects the reference spans to format once the text is attached to
 * a document. Formatting a detached Y.Text is undefined — it warns and relies on
 * Yjs replaying pending ops — so the attribute is applied in buildDocState,
 * after every block has been integrated into the blocks map.
 */
function ytext(s, resolveLink, pending) {
  const t = new Y.Text();
  const str = String(s ?? '');
  if (!str) return t;
  if (!resolveLink) {
    t.insert(0, str);
    return t;
  }
  // Assemble the plain string and note where each reference lands, then insert
  // once. Offsets come from the string, never from `t.length` — reading a
  // detached Y.Text is exactly what Yjs warns about.
  let plain = '';
  let last = 0;
  let m;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(str)) !== null) {
    const pageId = resolveLink(m[1].trim());
    // Unknown target: leave the literal `[[key]]` in place rather than silently
    // dropping it, so a typo in the source is visible instead of invisible.
    if (!pageId) continue;
    plain += str.slice(last, m.index);
    pending?.push({ text: t, index: plain.length, pageId });
    plain += REFERENCE_NODE;
    last = m.index + m[0].length;
  }
  plain += str.slice(last);
  t.insert(0, plain);
  return t;
}

/** Every `[[key]]` a markdown source resolves to, deduped. */
export function collectMarkdownLinks(markdown, resolveLink) {
  const ids = new Set();
  let m;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(String(markdown || ''))) !== null) {
    const id = resolveLink(m[1].trim());
    if (id) ids.add(id);
  }
  return [...ids];
}

const isTableLine = (l) => /^\s*\|.*\|\s*$/.test(l);
const isTableSep = (cells) => cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c.trim()));
const splitRow = (l) => {
  // "| a | b |" -> ["a","b"] — drop the empty edges from the border pipes.
  const parts = l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  return parts;
};

/** Markdown → flat block descriptors (block-level structure; inline text is literal). */
export function parseMarkdown(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const code = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
      out.push({ flavour: 'affine:code', language: fence[1] || 'plain', text: code.join('\n') });
      continue;
    }
    // Pipe table: a run of "| … |" lines. The all-dashes row is the header
    // separator and is dropped; every other row becomes a table row.
    if (isTableLine(line) && i + 1 < lines.length && isTableLine(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && isTableLine(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      i--; // step back; the for-loop will advance past the last table line
      const body = rows.filter((r) => !isTableSep(r));
      if (body.length) out.push({ flavour: 'affine:table', rows: body });
      continue;
    }
    if (/^\s*$/.test(line)) continue;
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push({ flavour: 'affine:divider' }); continue; }
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { out.push({ flavour: 'affine:paragraph', type: 'h' + m[1].length, text: m[2] }); continue; }
    if ((m = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/))) { out.push({ flavour: 'affine:list', type: 'todo', checked: m[1].toLowerCase() === 'x', text: m[2] }); continue; }
    if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) { out.push({ flavour: 'affine:list', type: 'numbered', text: m[1] }); continue; }
    if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { out.push({ flavour: 'affine:list', type: 'bulleted', text: m[1] }); continue; }
    if ((m = line.match(/^>\s?(.*)$/))) { out.push({ flavour: 'affine:paragraph', type: 'quote', text: m[1] }); continue; }
    out.push({ flavour: 'affine:paragraph', type: 'text', text: line });
  }
  return out;
}

function makeBlock(blocks, desc, resolveLink, pending) {
  const id = blockId();
  const b = new Y.Map();
  b.set('sys:id', id);
  b.set('sys:flavour', desc.flavour);
  b.set('sys:version', 1);
  b.set('sys:children', new Y.Array());
  if (desc.flavour === 'affine:divider') {
    // nothing else
  } else if (desc.flavour === 'affine:table') {
    // BlockSuite 0.22 table: flat keys — prop:rows.<id>.{rowId,order},
    // prop:columns.<id>.{columnId,order}, prop:cells.<row>:<col>.text.
    // `order` is a lexicographically-sortable fractional-index string; a fixed
    // zero-padded counter sorts identically and stays simple.
    const orderKey = (n) => 'a' + String(n).padStart(6, '0');
    const rows = desc.rows || [];
    const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0) || 1;
    const rowIds = rows.map(() => blockId());
    const colIds = Array.from({ length: colCount }, () => blockId());
    rowIds.forEach((rid, r) => {
      b.set(`prop:rows.${rid}.rowId`, rid);
      b.set(`prop:rows.${rid}.order`, orderKey(r));
    });
    colIds.forEach((cid, c) => {
      b.set(`prop:columns.${cid}.columnId`, cid);
      b.set(`prop:columns.${cid}.order`, orderKey(c));
    });
    rows.forEach((row, r) => {
      for (let c = 0; c < colCount; c++) {
        b.set(`prop:cells.${rowIds[r]}:${colIds[c]}.text`, ytext(row[c] ?? '', resolveLink, pending));
      }
    });
    b.set('prop:meta:createdAt', desc.now || 0);
    b.set('prop:meta:createdBy', desc.by || 'migration');
    b.set('prop:meta:updatedAt', desc.now || 0);
    b.set('prop:meta:updatedBy', desc.by || 'migration');
  } else if (desc.flavour === 'affine:code') {
    b.set('prop:text', ytext(desc.text));
    b.set('prop:language', desc.language || 'plain');
    b.set('prop:wrap', false);
  } else if (desc.flavour === 'affine:list') {
    b.set('prop:type', desc.type);
    b.set('prop:text', ytext(desc.text, resolveLink, pending));
    b.set('prop:checked', !!desc.checked);
    b.set('prop:collapsed', false);
  } else {
    b.set('prop:type', desc.type || 'text');
    b.set('prop:text', ytext(desc.text, resolveLink, pending));
    b.set('prop:collapsed', false);
  }
  blocks.set(id, b);
  return id;
}

function makeNote(blocks, childIds) {
  const id = blockId();
  const note = new Y.Map();
  note.set('sys:id', id);
  note.set('sys:flavour', 'affine:note');
  note.set('sys:version', 1);
  const children = new Y.Array();
  children.push(childIds);
  note.set('sys:children', children);
  note.set('prop:xywh', '[0,0,800,95]');
  const bg = new Y.Map(); bg.set('dark', '#252525'); bg.set('light', '#ffffff');
  note.set('prop:background', bg);
  note.set('prop:index', 'a0');
  note.set('prop:lockedBySelf', false);
  note.set('prop:hidden', false);
  note.set('prop:displayMode', 'both');
  const edgeless = new Y.Map(); const style = new Y.Map();
  style.set('borderRadius', 8); style.set('borderSize', 4);
  style.set('borderStyle', 'none'); style.set('shadowType', '--affine-note-shadow-box');
  edgeless.set('style', style);
  note.set('prop:edgeless', edgeless);
  blocks.set(id, note);
  return id;
}

/**
 * Full doc from scratch: page → note → content blocks. Returns a Uint8Array state.
 * `resolveLink(key)` turns a `[[key]]` in the markdown into a page reference;
 * omit it and `[[key]]` stays literal text.
 */
export function buildDocState(title, markdown, resolveLink) {
  const doc = new Y.Doc();
  const blocks = doc.getMap('blocks');
  const pending = [];
  const descs = parseMarkdown(markdown);
  // Drop a leading heading that just repeats the title — the page title already
  // renders it, so keeping it would duplicate the title in the body.
  if (descs.length && descs[0].flavour === 'affine:paragraph' && /^h[1-6]$/.test(descs[0].type || '')
      && String(title || '').trim() && (descs[0].text || '').trim() === String(title).trim()) {
    descs.shift();
  }
  if (descs.length === 0) descs.push({ flavour: 'affine:paragraph', type: 'text', text: '' });
  const childIds = descs.map((d) => makeBlock(blocks, d, resolveLink, pending));
  const noteId = makeNote(blocks, childIds);

  const pageId = blockId();
  const page = new Y.Map();
  page.set('sys:id', pageId);
  page.set('sys:flavour', 'affine:page');
  page.set('sys:version', 2);
  const pageChildren = new Y.Array(); pageChildren.push([noteId]);
  page.set('sys:children', pageChildren);
  page.set('prop:title', ytext(title || ''));
  blocks.set(pageId, page);

  // Every block is integrated now, so the reference spans can be formatted for
  // real instead of queued against a detached type.
  for (const { text, index, pageId: target } of pending) {
    text.format(index, REFERENCE_NODE.length, { reference: { type: 'LinkedPage', pageId: target } });
  }

  return Y.encodeStateAsUpdate(doc);
}

/** Decode a doc_states buffer to plain text (title + block text, in tree order). */
export function extractText(existing) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(existing));
  const blocks = doc.getMap('blocks');
  const get = (id) => blocks.get(id);
  const textOf = (b) => {
    const t = b.get('prop:text');
    return t instanceof Y.Text ? t.toString() : '';
  };
  // find the page block, then walk children depth-first.
  let page = null, title = '';
  for (const [, b] of blocks) {
    if (b instanceof Y.Map && b.get('sys:flavour') === 'affine:page') {
      page = b;
      const t = b.get('prop:title');
      title = t instanceof Y.Text ? t.toString() : '';
      break;
    }
  }
  const lines = [];
  const walk = (id) => {
    const b = get(id);
    if (!(b instanceof Y.Map)) return;
    const fl = b.get('sys:flavour');
    if (fl === 'affine:paragraph' || fl === 'affine:list' || fl === 'affine:code') {
      const txt = textOf(b);
      if (txt) lines.push(txt);
    }
    const kids = b.get('sys:children');
    if (kids instanceof Y.Array) for (const c of kids.toArray()) walk(c);
  };
  if (page) { const kids = page.get('sys:children'); if (kids instanceof Y.Array) for (const c of kids.toArray()) walk(c); }
  return { title, text: lines.join('\n') };
}

/** Decode a doc_states buffer to {title, blocks[]} with flavour/type/checked, tree order. */
export function extractBlocks(existing) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(existing));
  const blocksMap = doc.getMap('blocks');
  const get = (id) => blocksMap.get(id);
  const textOf = (b) => {
    const t = b.get('prop:text');
    return t instanceof Y.Text ? t.toString() : '';
  };
  let page = null, title = '';
  for (const [, b] of blocksMap) {
    if (b instanceof Y.Map && b.get('sys:flavour') === 'affine:page') {
      page = b;
      const t = b.get('prop:title');
      title = t instanceof Y.Text ? t.toString() : '';
      break;
    }
  }
  const out = [];
  const walk = (id) => {
    const b = get(id);
    if (!(b instanceof Y.Map)) return;
    const fl = b.get('sys:flavour');
    if (fl === 'affine:paragraph' || fl === 'affine:list' || fl === 'affine:code') {
      out.push({
        flavour: fl,
        type: b.get('prop:type') || 'text',
        checked: !!b.get('prop:checked'),
        text: textOf(b),
      });
    }
    const kids = b.get('sys:children');
    if (kids instanceof Y.Array) for (const c of kids.toArray()) walk(c);
  };
  if (page) { const kids = page.get('sys:children'); if (kids instanceof Y.Array) for (const c of kids.toArray()) walk(c); }
  return { title, blocks: out };
}

/** Append markdown blocks to an existing doc_states buffer. Returns new state. */
export function appendToDocState(existing, markdown) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(existing));
  const blocks = doc.getMap('blocks');
  // find the note (first affine:note); fall back to rebuilding if malformed.
  let note = null;
  for (const [, b] of blocks) {
    if (b instanceof Y.Map && b.get('sys:flavour') === 'affine:note') { note = b; break; }
  }
  if (!note) return buildDocState('', markdown);
  const descs = parseMarkdown(markdown);
  const children = note.get('sys:children');
  for (const d of descs) children.push([makeBlock(blocks, d)]);
  return Y.encodeStateAsUpdate(doc);
}

// A content block re-serialized to markdown-ish source, so both already-typed
// blocks and literal-markdown text blocks reduce to one canonical form we can
// re-parse into proper blocks.
function blockToMarkdown(b) {
  const t = b.get('prop:text');
  const text = t instanceof Y.Text ? t.toString() : '';
  const fl = b.get('sys:flavour');
  const type = b.get('prop:type') || 'text';
  if (fl === 'affine:code') return '```' + (b.get('prop:language') || '') + '\n' + text + '\n```';
  if (fl === 'affine:divider') return '---';
  if (fl === 'affine:list') {
    if (type === 'todo') return `- [${b.get('prop:checked') ? 'x' : ' '}] ${text}`;
    if (type === 'numbered') return `1. ${text}`;
    return `- ${text}`;
  }
  if (/^h[1-6]$/.test(type)) return '#'.repeat(Number(type[1])) + ' ' + text;
  if (type === 'quote') return '> ' + text;
  return text;
}

// Flavours we know how to reduce to markdown and rebuild. Anything else (table,
// image, embed, bookmark, database, callout, nested note, …) means the doc is
// NOT a plain literal-markdown import — leave it untouched.
const REBUILDABLE = new Set(['affine:paragraph', 'affine:list', 'affine:code', 'affine:divider']);
const LITERAL_MARKER = /^\s*#{1,6}\s|^\s*\|.*\|\s*$|^\s*[-*]\s+|^\s*\d+\.\s+|^\s*>\s|^\s*(-{3,}|\*{3,}|_{3,})\s*$|^```/;

/**
 * In-place normalize a legacy literal-markdown document. Loads the EXISTING
 * doc (same GUID/history — not a fresh rebuild), and if every content block is
 * rebuildable AND at least one type='text' paragraph carries literal markdown,
 * replaces the note's children with proper heading/list/quote/table blocks and
 * drops a leading H1 that merely repeats the page title. Returns the new state
 * Uint8Array, or null when the doc is already fine / not a plain import.
 */
export function normalizeDocState(existing, opts = {}) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(existing));
  const blocks = doc.getMap('blocks');

  let page = null, note = null, title = '';
  for (const [, b] of blocks) {
    if (!(b instanceof Y.Map)) continue;
    const fl = b.get('sys:flavour');
    if (fl === 'affine:page') { page = b; const t = b.get('prop:title'); title = t instanceof Y.Text ? t.toString() : ''; }
    if (fl === 'affine:note' && !note) note = b;
  }
  if (!note) return null;

  // Collect the note's direct content children (top level; legacy imports are flat).
  const childArr = note.get('sys:children');
  if (!(childArr instanceof Y.Array)) return null;
  const childIds = childArr.toArray();
  const childBlocks = childIds.map((id) => blocks.get(id)).filter((b) => b instanceof Y.Map);

  // Bail if any child is not a plain rebuildable block, or nests children.
  let hasLiteral = false;
  for (const b of childBlocks) {
    const fl = b.get('sys:flavour');
    if (!REBUILDABLE.has(fl)) return null;
    const kids = b.get('sys:children');
    if (kids instanceof Y.Array && kids.length > 0) return null;
    if (fl === 'affine:paragraph' && (b.get('prop:type') || 'text') === 'text') {
      const t = b.get('prop:text');
      if (t instanceof Y.Text && LITERAL_MARKER.test(t.toString())) hasLiteral = true;
    }
  }
  if (!hasLiteral) return null; // already clean — nothing to do

  // Reduce to canonical markdown, then re-parse into proper blocks.
  const md = childBlocks.map(blockToMarkdown).join('\n');
  let descs = parseMarkdown(md);
  // Drop a leading heading that just repeats the title.
  if (descs.length && descs[0].flavour === 'affine:paragraph' && /^h[1-6]$/.test(descs[0].type || '')
      && (descs[0].text || '').trim() === title.trim() && title.trim()) {
    descs = descs.slice(1);
  }
  if (!descs.length) descs = [{ flavour: 'affine:paragraph', type: 'text', text: '' }];
  const by = opts.by || 'migration';
  descs.forEach((d) => { d.by = by; d.now = opts.now || 0; });

  doc.transact(() => {
    // Remove old content blocks, then rebuild the children list.
    for (const id of childIds) blocks.delete(id);
    childArr.delete(0, childArr.length);
    for (const d of descs) childArr.push([makeBlock(blocks, d)]);
  });

  return Y.encodeStateAsUpdate(doc);
}
