// Build a BlockSuite (0.22.4) Yjs doc state from markdown, entirely with plain
// yjs — no BlockSuite runtime. The block schema (flavours, versions, sys:/prop:
// keys, note defaults) mirrors what the editor produces natively, so a doc built
// here renders in the editor and syncs over Hocuspocus like any other.
import * as Y from 'yjs';
import crypto from 'node:crypto';

const blockId = () => crypto.randomBytes(8).toString('base64url').slice(0, 10);

function ytext(s) {
  const t = new Y.Text();
  if (s) t.insert(0, String(s));
  return t;
}

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

function makeBlock(blocks, desc) {
  const id = blockId();
  const b = new Y.Map();
  b.set('sys:id', id);
  b.set('sys:flavour', desc.flavour);
  b.set('sys:version', 1);
  b.set('sys:children', new Y.Array());
  if (desc.flavour === 'affine:divider') {
    // nothing else
  } else if (desc.flavour === 'affine:code') {
    b.set('prop:text', ytext(desc.text));
    b.set('prop:language', desc.language || 'plain');
    b.set('prop:wrap', false);
  } else if (desc.flavour === 'affine:list') {
    b.set('prop:type', desc.type);
    b.set('prop:text', ytext(desc.text));
    b.set('prop:checked', !!desc.checked);
    b.set('prop:collapsed', false);
  } else {
    b.set('prop:type', desc.type || 'text');
    b.set('prop:text', ytext(desc.text));
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

/** Full doc from scratch: page → note → content blocks. Returns a Uint8Array state. */
export function buildDocState(title, markdown) {
  const doc = new Y.Doc();
  const blocks = doc.getMap('blocks');
  const descs = parseMarkdown(markdown);
  if (descs.length === 0) descs.push({ flavour: 'affine:paragraph', type: 'text', text: '' });
  const childIds = descs.map((d) => makeBlock(blocks, d));
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
