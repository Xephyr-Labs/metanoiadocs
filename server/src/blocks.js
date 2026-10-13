// Build a BlockSuite (0.22.4) Yjs doc state from markdown, entirely with plain
// yjs — no BlockSuite runtime. The block schema (flavours, versions, sys:/prop:
// keys, note defaults) mirrors what the editor produces natively, so a doc built
// here renders in the editor and syncs over Hocuspocus like any other.
import * as Y from 'yjs';
import crypto from 'node:crypto';
import fs from 'node:fs';

// Every name the editor's code block recognises (shiki's id, display name and
// aliases) → the id it stores. The editor rewrites any other value on first
// open ("js" → "javascript", unknown → null), and that rewrite saved the page
// as an edit by whoever merely opened it. Regenerate after a BlockSuite/shiki
// upgrade, from web-react:
//   node --input-type=module -e "import{bundledLanguagesInfo as L}from'shiki';const m={};for(const l of L)for(const k of[l.id,l.name,...(l.aliases||[])])if(k&&!(k in m))m[k]=l.id;console.log(JSON.stringify(m))" > ../server/src/code-languages.json
const CODE_LANGS = JSON.parse(fs.readFileSync(new URL('./code-languages.json', import.meta.url), 'utf8'));

const blockId = () => crypto.randomBytes(8).toString('base64url').slice(0, 10);

// A page reference is one space carrying a `reference` attribute — BlockSuite's
// REFERENCE_NODE. `[[key]]` in the source markdown becomes one, via a resolver
// the caller supplies (the seed knows its own doc ids; nobody else passes one).
const REFERENCE_NODE = ' ';
const LINK_RE = /\[\[([^\]\n]+)\]\]/g;

// Inline markdown, in the order a match is preferred. `raw` means the contents
// are literal — nothing inside a code span is markup.
const INLINE = [
  { re: /`([^`\n]+)`/, raw: true, attrs: () => ({ code: true }) },
  { re: /\*\*([^*\n]+)\*\*/, attrs: () => ({ bold: true }) },
  { re: /__([^_\n]+)__/, attrs: () => ({ bold: true }) },
  { re: /~~([^~\n]+)~~/, attrs: () => ({ strike: true }) },
  // Not `_italic_`: snake_case identifiers are everywhere in technical writing
  // and turning half of one italic is worse than missing the emphasis.
  { re: /(?<![*\w])\*([^*\n]+)\*(?!\*)/, attrs: () => ({ italic: true }) },
  { re: /\[([^\]\n]+)\]\(([^)\s]+)\)/, attrs: (m) => ({ link: m[2] }) },
  // Markdown has no colour, so these are the HTML an author (an agent above
  // all) would reach for. Only the editor's own palette is accepted — the
  // same names its Color menu offers — so a document never carries a colour
  // the theme cannot draw in dark mode.
  { re: /<span style="([^"<>]*)">([^\n]*?)<\/span>/, group: 2, attrs: (m) => spanAttrs(m[1]) },
  { re: /<u>([^\n]*?)<\/u>/, attrs: () => ({ underline: true }) },
  { re: /<mark>([^\n]*?)<\/mark>/, attrs: () => ({ background: highlight('yellow') }) },
];

/** The editor's text palette (BlockSuite's Color menu), by name. */
export const TEXT_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'grey'];
const foreground = (c) => `var(--affine-text-highlight-foreground-${c})`;
const highlight = (c) => `var(--affine-text-highlight-${c})`;
const colorName = (v) => {
  const c = String(v).trim().toLowerCase().replace(/^gray$/, 'grey');
  return TEXT_COLORS.includes(c) ? c : null;
};

/** `color: red; background: yellow` → the editor's inline attributes. */
function spanAttrs(style) {
  const out = {};
  for (const decl of style.split(';')) {
    const [k, v] = decl.split(':').map((x) => x?.trim().toLowerCase());
    const c = v && colorName(v);
    if (!c) continue;
    if (k === 'color') out.color = foreground(c);
    else if (k === 'background' || k === 'background-color') out.background = highlight(c);
  }
  return out;
}

/** The colour name an inline attribute holds, if it is one of the palette's. */
const nameOf = (v, kind) => {
  const m = String(v ?? '').match(kind === 'color'
    ? /--affine-text-highlight-foreground-([a-z]+)\)/
    : /--affine-text-highlight-([a-z]+)\)/);
  return m && TEXT_COLORS.includes(m[1]) ? m[1] : null;
};

/** `<small>…</small>` or `<big>…</big>` around a whole line: a body-text size
 *  (the editor's Text size; stored as `prop:mnSize`, see textSize.ts). */
const SIZE_RE = /^<(small|big)>((?:(?!<\/?\1>)[\s\S])*)<\/\1>$/;
const SIZE_TAG = { small: 'small', large: 'big' };

/** A string → runs of text with the marks that apply to them, nesting included. */
function inlineRuns(str, resolveLink, attrs = {}) {
  const runs = [];
  let rest = String(str ?? '');
  while (rest) {
    // Earliest match wins, so `a **b** c` splits where the source says it does.
    let best = null;
    if (resolveLink) {
      const m = /\[\[([^\]\n]+)\]\]/.exec(rest);
      if (m) best = { index: m.index, m, ref: true };
    }
    for (const rule of INLINE) {
      const m = rule.re.exec(rest);
      if (m && (!best || m.index < best.index)) best = { index: m.index, m, rule };
    }
    if (!best) { runs.push({ text: rest, attrs }); break; }
    if (best.index > 0) runs.push({ text: rest.slice(0, best.index), attrs });
    const m = best.m;
    if (best.ref) {
      const pageId = resolveLink(m[1].trim());
      // Unknown target: leave the literal `[[key]]` in place rather than
      // silently dropping it, so a typo is visible instead of invisible.
      if (pageId) runs.push({ text: REFERENCE_NODE, attrs: { ...attrs, reference: { type: 'LinkedPage', pageId } } });
      else runs.push({ text: m[0], attrs });
    } else if (best.rule.raw) {
      runs.push({ text: m[1], attrs: { ...attrs, ...best.rule.attrs(m) } });
    } else {
      runs.push(...inlineRuns(m[best.rule.group ?? 1], resolveLink, { ...attrs, ...best.rule.attrs(m) }));
    }
    rest = rest.slice(best.index + m[0].length);
  }
  return runs;
}

/**
 * `pending` collects the formatting to apply once the text is attached to a
 * document. Formatting a detached Y.Text is undefined — it warns and relies on
 * Yjs replaying pending ops — so attributes are applied by the caller, after
 * every block has been integrated into the blocks map.
 */
function ytext(s, resolveLink, pending) {
  const t = new Y.Text();
  const str = String(s ?? '');
  if (!str) return t;
  // Assemble the plain string and note where each mark lands, then insert once.
  // Offsets come from the string, never from `t.length` — reading a detached
  // Y.Text is exactly what Yjs warns about.
  const runs = inlineRuns(str, resolveLink);
  let plain = '';
  const marks = [];
  for (const r of runs) {
    if (!r.text) continue;
    if (Object.keys(r.attrs).length) marks.push({ index: plain.length, length: r.text.length, attrs: r.attrs });
    plain += r.text;
  }
  t.insert(0, plain);
  for (const mk of marks) pending?.push({ text: t, ...mk });
  return t;
}

/** Literal text, no markup: code blocks and titles mean exactly what they say. */
function plainYText(s) {
  const t = new Y.Text();
  const str = String(s ?? '');
  if (str) t.insert(0, str);
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
  // "| a | b |" -> ["a","b"] — drop the empty edges from the border pipes. A
  // `\|` is a pipe inside a cell (the export writes them that way), not a border.
  const parts = l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));
  return parts;
};

/** Leading spaces → list nesting level. Two spaces or one tab per level, which
 *  covers what every markdown editor emits (4-space indents nest twice as deep,
 *  and that is what the source asked for). */
const indentDepth = (s) => Math.floor(s.replace(/\t/g, '  ').length / 2);

// Panel types, as the web editor stores them (`prop:mnPanel`, see
// web-react/src/editor/callout.ts). GitHub's five alert names map onto them.
// A plain callout has no panel type at all — the editor stores neutral as the
// prop's absence — and is written `[!CALLOUT 💡]`, its emoji inside the marker,
// because that emoji is all that tells one plain callout from another.
const PANEL_EMOJI = { info: 'ℹ️', note: '📝', success: '✅', warning: '⚠️', error: '❌' };
const PANEL_ALIASES = {
  info: 'info', note: 'note', success: 'success', warning: 'warning', error: 'error',
  tip: 'success', important: 'info', caution: 'error', danger: 'error', callout: null,
};
// BlockSuite's own default icon, for a plain callout written without one.
const CALLOUT_EMOJI = '😀';
const PANEL_RE = new RegExp(`^>\\s?\\[!(${Object.keys(PANEL_ALIASES).join('|')})(?:\\s+([^\\]\\s]+))?\\]\\s*(.*)$`, 'i');

/** Markdown → flat block descriptors (block-level structure; inline text is literal). */
export function parseMarkdown(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  // Whether the previous line was blank — i.e. whether the next text line
  // starts something new or continues what is already open.
  let blank = true;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const code = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
      out.push({ flavour: 'affine:code', language: fence[1] || 'plain', text: code.join('\n') });
      blank = false;
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
      blank = false;
      continue;
    }
    // A blank line ends whatever was being written; without tracking it, the
    // continuation rule below would glue two paragraphs into one.
    if (/^\s*$/.test(line)) { blank = true; continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push({ flavour: 'affine:divider' }); blank = false; continue; }
    let m;
    // A line that is only an image becomes a real image block. The source has
    // to be a blob this server already holds (`/api/blob/<sha256>`) — that is
    // what the .docx importer emits and what the MCP server uploads to before
    // it writes — because BlockSuite addresses images by blob key, not by URL.
    // Anything else stays literal text rather than rendering as a broken image.
    if ((m = line.match(/^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/))) {
      const key = /^(?:[a-z]+:\/\/[^/]+)?\/api\/blob\/([^?#]+)/i.exec(m[2])?.[1];
      if (key) {
        out.push({ flavour: 'affine:image', caption: m[1], sourceId: decodeURIComponent(key) });
        blank = false;
        continue;
      }
    }
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { out.push({ flavour: 'affine:paragraph', type: 'h' + m[1].length, text: m[2] }); blank = false; continue; }
    if ((m = line.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/))) { out.push({ flavour: 'affine:list', type: 'todo', checked: m[2].toLowerCase() === 'x', text: m[3], depth: indentDepth(m[1]) }); blank = false; continue; }
    if ((m = line.match(/^(\s*)\d+\.\s+(.*)$/))) { out.push({ flavour: 'affine:list', type: 'numbered', text: m[2], depth: indentDepth(m[1]) }); blank = false; continue; }
    if ((m = line.match(/^(\s*)[-*]\s+(.*)$/))) { out.push({ flavour: 'affine:list', type: 'bulleted', text: m[2], depth: indentDepth(m[1]) }); blank = false; continue; }
    // `> [!NOTE]` and the `>` lines under it are a panel (the editor's
    // callout block), GitHub's alert syntax. Its body is markdown in its own
    // right; a callout only holds paragraphs and lists, so anything else in it
    // is kept as its text.
    if ((m = line.match(PANEL_RE))) {
      const inner = [];
      if (m[3].trim()) inner.push(m[3]);
      while (i + 1 < lines.length && /^>/.test(lines[i + 1])) inner.push(lines[++i].replace(/^>\s?/, ''));
      const panel = PANEL_ALIASES[m[1].toLowerCase()];
      // A panel quoted inside this one (`> > [!WARNING]`) cannot nest, so its
      // lines join this panel's rather than vanishing with it.
      const children = parseMarkdown(inner.join('\n')).flatMap((d) =>
        d.flavour === 'affine:paragraph' || d.flavour === 'affine:list'
          ? [d]
          : d.flavour === 'affine:callout'
            ? d.children
            : [{ flavour: 'affine:paragraph', type: 'text', text: d.text ?? (d.rows || []).map((r) => r.join(' | ')).join(' ') }]);
      // An empty panel still needs a line to type into.
      if (!children.length) children.push({ flavour: 'affine:paragraph', type: 'text', text: '' });
      out.push({ flavour: 'affine:callout', panel, emoji: m[2] || PANEL_EMOJI[panel] || CALLOUT_EMOJI, children });
      blank = false;
      continue;
    }
    if ((m = line.match(/^>\s?(.*)$/))) {
      // A run of `>` lines is one quote, its lines kept as lines — the editor
      // holds a multi-line quote as one block with line breaks in its text. One
      // block per source line drew a stack of separate quotes, each with its
      // own gap.
      const prev = out[out.length - 1];
      if (!blank && prev?.flavour === 'affine:paragraph' && prev.type === 'quote') prev.text = `${prev.text}\n${m[1]}`;
      else out.push({ flavour: 'affine:paragraph', type: 'quote', text: m[1] });
      blank = false;
      continue;
    }
    // Plain text directly under the previous line continues it: markdown wraps
    // a paragraph across lines, and one block per source line turns a hard
    // -wrapped file into hundreds of one-line paragraphs.
    const prev = out[out.length - 1];
    if (!blank && prev) {
      // A lazy continuation (no `>`) of a quote's last line joins that line.
      const continuesParagraph = prev.flavour === 'affine:paragraph' && (prev.type === 'text' || prev.type === 'quote');
      // An indented run-on under a list item belongs to that item, not after it.
      const continuesList = prev.flavour === 'affine:list' && /^\s\s+\S/.test(line);
      if (continuesParagraph || continuesList) { prev.text = `${prev.text} ${line.trim()}`; continue; }
    }
    out.push({ flavour: 'affine:paragraph', type: 'text', text: line });
    blank = false;
  }
  return out;
}

/**
 * An image descriptor as the markdown paragraph it came from. Renderers that
 * turn descriptors into something other than BlockSuite blocks (docx, print)
 * already parse `![alt](src)` out of paragraph text, images and all, so they
 * take their descriptors through here rather than growing a second image path.
 */
export const imageDescAsParagraph = (d) =>
  d.flavour === 'affine:callout' ? calloutAsQuote(d) : imageAsParagraph(d);

/** A panel for renderers without one: its label and body, as a quote. */
const calloutAsQuote = (d) => ({
  flavour: 'affine:paragraph',
  type: 'quote',
  text: [d.panel ? `**${d.panel[0].toUpperCase()}${d.panel.slice(1)}:**` : d.emoji,
    ...d.children.map((c) => c.text)].filter(Boolean).join(' '),
});

const imageAsParagraph = (d) =>
  d.flavour === 'affine:image'
    ? { flavour: 'affine:paragraph', type: 'text', text: `![${d.caption || ''}](/api/blob/${d.sourceId})` }
    : d;

/** A body line's text without its `<small>`/`<big>` wrapper, and the size the
 *  wrapper asked for. Headings keep their own scale and take no size. */
function sizedText(desc) {
  const text = String(desc.text ?? '');
  if (/^h[1-6]$/.test(desc.type || '')) return { text, size: null };
  const size = (tag) => (tag === 'small' ? 'small' : 'large');
  // One wrapper around the whole line (or the whole of a multi-line quote) —
  // and never two on one line, `<small>a</small> and <small>b</small>`, which
  // a greedy match would have read as one with the tags left in the middle.
  const m = text.match(SIZE_RE);
  if (m) return { text: m[2], size: size(m[1]) };
  // A quote whose lines were each wrapped (`> <small>a</small>` per line,
  // joined into one block on import) is sized when every line agrees.
  const lines = text.split('\n').map((l) => l.match(SIZE_RE));
  if (lines.length > 1 && lines.every((l) => l && l[1] === lines[0][1])) {
    return { text: lines.map((l) => l[2]).join('\n'), size: size(lines[0][1]) };
  }
  return { text, size: null };
}

/** A body line's markdown wrapped back in its size tag, if it has one. */
const withSize = (b, md) => {
  const tag = SIZE_TAG[b.get('prop:mnSize')];
  return tag && md ? `<${tag}>${md}</${tag}>` : md;
};

function makeBlock(blocks, desc, resolveLink, pending) {
  const id = blockId();
  const b = new Y.Map();
  b.set('sys:id', id);
  b.set('sys:flavour', desc.flavour);
  b.set('sys:version', 1);
  const children = new Y.Array();
  b.set('sys:children', children);
  if (desc.flavour === 'affine:divider') {
    // nothing else
  } else if (desc.flavour === 'affine:callout') {
    b.set('prop:emoji', desc.emoji);
    b.set('prop:text', new Y.Text());
    if (desc.panel) b.set('prop:mnPanel', desc.panel);
    // `b` is not in the doc yet, so read back through it would be undefined.
    children.push(makeBlocks(blocks, desc.children, resolveLink, pending));
  } else if (desc.flavour === 'affine:table') {
    // BlockSuite 0.22 table: flat keys — prop:rows.<id>.{rowId,order},
    // prop:columns.<id>.{columnId,order}, prop:cells.<row>:<col>.text.
    // `order` is a fractional-index key (the `fractional-indexing` package the
    // editor inserts rows with). A fixed zero-padded counter sorts identically
    // and stays simple — but that package rejects a key whose fraction ends in
    // '0' (a000000, a000010), and then the editor cannot add a row or column
    // beside it. The trailing '1' keeps every key valid and the order intact.
    const orderKey = (n) => 'a' + String(n).padStart(6, '0') + '1';
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
  } else if (desc.flavour === 'affine:image') {
    // width/height 0 tells the editor to render the image at its natural size,
    // so we never have to decode the bytes just to learn how big they are.
    b.set('prop:sourceId', desc.sourceId || '');
    b.set('prop:caption', desc.caption || '');
    b.set('prop:width', 0);
    b.set('prop:height', 0);
    b.set('prop:size', -1);
    b.set('prop:rotate', 0);
    b.set('prop:index', 'a0');
    b.set('prop:xywh', '[0,0,0,0]');
    b.set('prop:lockedBySelf', false);
  } else if (desc.flavour === 'affine:code') {
    b.set('prop:text', plainYText(desc.text));
    // Own keys only: a fence named `constructor` or `__proto__` would otherwise
    // read Object.prototype and hand Yjs a function.
    b.set('prop:language', Object.hasOwn(CODE_LANGS, desc.language) ? CODE_LANGS[desc.language] : null);
    b.set('prop:wrap', false);
    b.set('prop:caption', '');
  } else if (desc.flavour === 'affine:list') {
    const { text, size } = sizedText(desc);
    b.set('prop:type', desc.type);
    b.set('prop:text', ytext(text, resolveLink, pending));
    b.set('prop:checked', !!desc.checked);
    b.set('prop:collapsed', false);
    if (size) b.set('prop:mnSize', size);
  } else {
    const { text, size } = sizedText(desc);
    b.set('prop:type', desc.type || 'text');
    b.set('prop:text', ytext(text, resolveLink, pending));
    b.set('prop:collapsed', false);
    if (size) b.set('prop:mnSize', size);
  }
  blocks.set(id, b);
  return id;
}

/**
 * Descriptors → top-level block ids, nesting indented list items under the item
 * above them. Anything that is not a list resets the nesting: in markdown a
 * paragraph ends the list it follows.
 */
function makeBlocks(blocks, descs, resolveLink, pending) {
  const top = [];
  // stack[d] owns the items at depth d+1. Kept in step with the source indent.
  const stack = [];
  for (const d of descs) {
    const id = makeBlock(blocks, d, resolveLink, pending);
    if (d.flavour !== 'affine:list') {
      stack.length = 0;
      top.push(id);
      continue;
    }
    // An over-indented item (jumping two levels at once) clamps to the deepest
    // list that actually exists rather than being dropped on the floor.
    const depth = Math.min(Math.max(0, d.depth || 0), stack.length);
    const parentId = depth > 0 ? stack[depth - 1] : null;
    if (parentId) blocks.get(parentId).get('sys:children').push([id]);
    else top.push(id);
    stack.length = depth;
    stack.push(id);
  }
  return top;
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
 * The edgeless canvas. Without one the whiteboard/slides view has nothing to
 * mount into and renders blank, so every page gets a surface even though the
 * page view never touches it. `prop:elements` is a BlockSuite "Boxed" value —
 * a Y.Map tagged with the native marker, holding the real Y.Map.
 */
function makeSurface(blocks) {
  const id = blockId();
  const surface = new Y.Map();
  surface.set('sys:id', id);
  surface.set('sys:flavour', 'affine:surface');
  surface.set('sys:version', 5);
  surface.set('sys:children', new Y.Array());
  const boxed = new Y.Map();
  boxed.set('type', '$blocksuite:internal:native$');
  boxed.set('value', new Y.Map());
  surface.set('prop:elements', boxed);
  blocks.set(id, surface);
  return id;
}

/**
 * Full doc from scratch: page → surface + note → content blocks. Returns a
 * Uint8Array state. `resolveLink(key)` turns a `[[key]]` in the markdown into a
 * page reference; omit it and `[[key]]` stays literal text.
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
  const childIds = makeBlocks(blocks, descs, resolveLink, pending);
  const surfaceId = makeSurface(blocks);
  const noteId = makeNote(blocks, childIds);

  const pageId = blockId();
  const page = new Y.Map();
  page.set('sys:id', pageId);
  page.set('sys:flavour', 'affine:page');
  page.set('sys:version', 2);
  const pageChildren = new Y.Array(); pageChildren.push([surfaceId, noteId]);
  page.set('sys:children', pageChildren);
  page.set('prop:title', plainYText(title || ''));
  blocks.set(pageId, page);

  applyMarks(pending);
  numberLists(blocks);
  return Y.encodeStateAsUpdate(doc);
}

/**
 * Every block is integrated by now, so the queued spans can be formatted for
 * real instead of against a detached type.
 */
function applyMarks(pending) {
  for (const { text, index, length, attrs } of pending) text.format(index, length, attrs);
}

/**
 * Give every list item the `prop:order` the editor would. It fills a missing
 * one itself on first open (numbered: one past the numbered sibling above,
 * else 1; anything else: null), and that fill saved the page as an edit by
 * whoever merely opened it. Only missing or wrong-typed values are touched, so
 * an existing doc keeps the numbers it has.
 */
function numberLists(blocks) {
  for (const [, parent] of blocks) {
    const kids = parent instanceof Y.Map && parent.get('sys:children');
    if (!(kids instanceof Y.Array)) continue;
    let prev = null;
    for (const id of kids.toArray()) {
      const b = blocks.get(id);
      if (b instanceof Y.Map && b.get('sys:flavour') === 'affine:list') {
        const numbered = b.get('prop:type') === 'numbered';
        const order = b.get('prop:order');
        if (numbered && !Number.isInteger(order)) {
          const above = prev?.get('sys:flavour') === 'affine:list' && prev.get('prop:type') === 'numbered' ? prev.get('prop:order') : 0;
          b.set('prop:order', (Number.isInteger(above) ? above : 1) + 1);
        } else if (!numbered && (order !== null || !b.has('prop:order'))) {
          b.set('prop:order', null);
        }
      }
      prev = b instanceof Y.Map ? b : null;
    }
  }
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

/**
 * Inline runs → markdown, keeping the marks the editor applied. Marks nest
 * innermost-first so `**bold *and italic* **` never crosses itself, and any
 * leading/trailing whitespace inside a run is moved outside the delimiters —
 * `** bold**` is not emphasis in any markdown parser.
 */
function inlineMarkdown(t, opts = {}) {
  if (!(t instanceof Y.Text)) return '';
  let out = '';
  for (const op of t.toDelta()) {
    const raw = typeof op.insert === 'string' ? op.insert : '';
    const a = op.attributes || {};
    if (a.reference) {
      // A page reference is a single space carrying the target. Without a title
      // resolver there is nothing readable to write, so it collapses away.
      const title = opts.resolveTitle?.(a.reference.pageId);
      if (title) out += `[[${title}]]`;
      continue;
    }
    if (!raw) continue;
    const lead = raw.match(/^\s*/)[0];
    const tail = raw.slice(lead.length).match(/\s*$/)[0];
    let s = raw.slice(lead.length, raw.length - tail.length);
    if (!s) { out += raw; continue; }
    if (a.code) s = '`' + s + '`';
    if (a.strike) s = `~~${s}~~`;
    if (a.italic) s = `*${s}*`;
    if (a.bold) s = `**${s}**`;
    if (a.underline) s = `<u>${s}</u>`;
    const fg = nameOf(a.color, 'color');
    const bg = nameOf(a.background, 'background');
    if (fg || bg) s = `<span style="${[fg && `color: ${fg}`, bg && `background: ${bg}`].filter(Boolean).join('; ')}">${s}</span>`;
    if (a.link) s = `[${s}](${a.link})`;
    out += lead + s + tail;
  }
  return out;
}

/** A table block's flat prop keys → a markdown pipe table. */
function tableMarkdown(b, opts) {
  const rows = [];
  const cols = [];
  for (const key of b.keys()) {
    let m = key.match(/^prop:rows\.(.+)\.order$/);
    if (m) { rows.push({ id: m[1], order: String(b.get(key) ?? '') }); continue; }
    m = key.match(/^prop:columns\.(.+)\.order$/);
    if (m) cols.push({ id: m[1], order: String(b.get(key) ?? '') });
  }
  if (!rows.length || !cols.length) return '';
  // By code point, as the editor sorts them (table-data-manager.ts). Fractional
  // keys mix cases — 'aZ' sorts before 'aa' — and localeCompare flips those.
  const byOrder = (x, y) => (x.order > y.order ? 1 : -1);
  rows.sort(byOrder);
  cols.sort(byOrder);
  // A cell may hold newlines and pipes; both would break the row apart.
  const cell = (r, c) =>
    inlineMarkdown(b.get(`prop:cells.${r}:${c}.text`), opts).replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
  const lines = rows.map((r) => `| ${cols.map((c) => cell(r.id, c.id)).join(' | ')} |`);
  // Markdown needs a header separator, and our own parser drops it on the way
  // back in — so the first row round-trips as the header it already was.
  lines.splice(1, 0, `| ${cols.map(() => '---').join(' | ')} |`);
  return lines.join('\n');
}

/**
 * Decode a doc_states buffer to `{ title, markdown }`.
 *
 * The inverse of buildDocState for everything buildDocState can make, plus the
 * block types only the editor produces (images, attachments, bookmarks, LaTeX).
 * `opts.resolveTitle(pageId)` renders page references as `[[Title]]`;
 * `opts.imageUrl(sourceId)` points image/attachment links at wherever the blob
 * is being served from.
 */
export function docToMarkdown(existing, opts = {}) {
  const imageUrl = opts.imageUrl || ((key) => `/api/blob/${encodeURIComponent(key)}`);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(existing));
  const blocks = doc.getMap('blocks');

  let page = null;
  let title = '';
  for (const [, b] of blocks) {
    if (b instanceof Y.Map && b.get('sys:flavour') === 'affine:page') {
      page = b;
      const t = b.get('prop:title');
      title = t instanceof Y.Text ? t.toString() : '';
      break;
    }
  }

  // Parts, not lines: list items pack together, everything else gets a blank
  // line between it and its neighbour.
  let parts = [];
  const text = (b) => inlineMarkdown(b.get('prop:text'), opts);

  const walk = (id, depth) => {
    const b = blocks.get(id);
    if (!(b instanceof Y.Map)) return;
    const fl = b.get('sys:flavour');
    let childDepth = depth;

    switch (fl) {
      // The edgeless canvas holds shapes and connectors, not document text.
      case 'affine:surface':
        return;
      // A note set to edgeless-only is deliberately absent from the page view;
      // exporting it would put back what the author hid.
      case 'affine:note':
        if (b.get('prop:displayMode') === 'edgeless') return;
        break;
      case 'affine:paragraph': {
        const type = b.get('prop:type') || 'text';
        const body = text(b);
        if (/^h[1-6]$/.test(type)) parts.push({ text: `${'#'.repeat(Number(type[1]))} ${body}` });
        else if (type === 'quote') parts.push({ text: withSize(b, body).split('\n').map((l) => `> ${l}`).join('\n') });
        else parts.push({ text: withSize(b, body) });
        break;
      }
      case 'affine:list': {
        const type = b.get('prop:type');
        const marker = type === 'numbered' ? '1.' : type === 'todo' ? `- [${b.get('prop:checked') ? 'x' : ' '}]` : '-';
        parts.push({ list: true, type, depth, text: `${'  '.repeat(depth)}${marker} ${withSize(b, text(b))}` });
        childDepth = depth + 1;
        break;
      }
      case 'affine:code':
        parts.push({ text: '```' + (b.get('prop:language') || '') + '\n' + text(b) + '\n```' });
        break;
      case 'affine:divider':
        parts.push({ text: '---' });
        break;
      case 'affine:table': {
        const t = tableMarkdown(b, opts);
        if (t) parts.push({ text: t });
        break;
      }
      case 'affine:image': {
        const src = b.get('prop:sourceId');
        if (src) parts.push({ text: `![${b.get('prop:caption') || ''}](${imageUrl(String(src))})` });
        break;
      }
      case 'affine:attachment': {
        const src = b.get('prop:sourceId');
        const name = b.get('prop:name') || 'attachment';
        if (src) parts.push({ text: `[${name}](${imageUrl(String(src))})` });
        break;
      }
      case 'affine:callout': {
        // Rendered on its own, then quoted line by line under its marker, so
        // the panel comes back in as the same panel.
        const outer = parts;
        parts = [];
        const kids = b.get('sys:children');
        if (kids instanceof Y.Array) for (const c of kids.toArray()) walk(c, 0);
        const body = joinParts(parts);
        parts = outer;
        const panel = b.get('prop:mnPanel');
        const marker = PANEL_EMOJI[panel]
          ? `> [!${panel.toUpperCase()}]`
          : `> [!CALLOUT${b.get('prop:emoji') ? ` ${b.get('prop:emoji')}` : ''}]`;
        parts.push({ text: [marker, ...(body ? body.split('\n') : [])].map((l, i) => (i && l ? `> ${l}` : i ? '>' : l)).join('\n') });
        return;
      }
      case 'affine:latex':
        parts.push({ text: '$$\n' + (b.get('prop:latex') || '') + '\n$$' });
        break;
      // A database renders as a view over its own row blocks; there is no
      // honest flat markdown for it, and half of one is worse than none.
      case 'affine:database':
        return;
      default: {
        // Bookmarks and every affine:embed-* variant carry a url + caption.
        const url = b.get('prop:url');
        if (url) parts.push({ text: `[${b.get('prop:title') || b.get('prop:caption') || url}](${url})` });
        break;
      }
    }

    const kids = b.get('sys:children');
    if (kids instanceof Y.Array) for (const c of kids.toArray()) walk(c, childDepth);
  };

  if (page) {
    const kids = page.get('sys:children');
    if (kids instanceof Y.Array) for (const c of kids.toArray()) walk(c, 0);
  }

  // Trailing empty paragraphs are what an editor leaves behind, not content.
  return { title, markdown: joinParts(parts) };
}

function joinParts(parts) {
  let markdown = '';
  parts.forEach((p, i) => {
    const prev = parts[i - 1];
    // List items pack together while they belong to the same list — a switch of
    // marker at the same level is a new list and needs the blank line, or the
    // two run together as one on the way back in.
    const packed = i > 0 && p.list && prev.list && (p.type === prev.type || p.depth > prev.depth);
    if (i) markdown += packed ? '\n' : '\n\n';
    markdown += p.text;
  });
  return markdown.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The note an append lands in: the page's first note that shows in page view.
 * Map order is not page order, and the first note found may be one set to
 * edgeless-only — text appended there never shows on the page. With no such
 * note, any note still beats none: a false return makes the caller rewrite the
 * whole body, which would throw away what the canvas holds.
 */
function bodyNote(blocks) {
  const isNote = (b) => b instanceof Y.Map && b.get('sys:flavour') === 'affine:note';
  const page = [...blocks.values()].find((b) => b instanceof Y.Map && b.get('sys:flavour') === 'affine:page');
  const kids = page?.get('sys:children');
  const notes = (kids instanceof Y.Array ? kids.toArray() : []).map((id) => blocks.get(id)).filter(isNote);
  return notes.find((n) => n.get('prop:displayMode') !== 'edgeless')
    ?? notes[0]
    ?? [...blocks.values()].find(isNote)
    ?? null;
}

/**
 * Append a paragraph holding one page reference to a LIVE Yjs document.
 *
 * Unlike the functions either side of this one, it mutates a doc it is handed
 * rather than decoding and re-encoding a buffer — the caller holds a Hocuspocus
 * direct connection, so this edit reaches everyone who has the page open and is
 * persisted by the same path a typed edit takes. Writing doc_states behind a
 * live session's back would simply be overwritten by it.
 *
 * The label is deliberately not written anywhere: a reference node is a single
 * space carrying the target id, and the editor renders the target's current
 * title through DocDisplayMetaProvider. So there is nothing to keep in sync,
 * and nothing to escape.
 *
 * @returns {boolean} false if the document has no note to append to.
 */
export function appendPageReference(doc, pageId) {
  const blocks = doc.getMap('blocks');
  const note = bodyNote(blocks);
  if (!note) return false;
  const children = note.get('sys:children');
  if (!(children instanceof Y.Array)) return false;

  const pending = [];
  // Any key resolves to the one target, so the placeholder text never matters.
  const id = makeBlock(blocks, { flavour: 'affine:paragraph', type: 'text', text: '[[ref]]' }, () => pageId, pending);
  applyMarks(pending);
  children.push([id]);
  return true;
}

/**
 * Append markdown blocks to a doc, in place.
 *
 * Takes the live Y.Doc rather than a state buffer so the same call works on a
 * document somebody has open right now: the blocks land as an ordinary
 * incremental edit that Yjs carries to every connected editor, instead of a
 * replacement state row written behind those editors' backs.
 *
 * False means the doc has no note block to append into — nobody has ever opened
 * it — which only the caller can resolve, by building a body from scratch.
 */
export function appendMarkdownToDoc(doc, markdown) {
  const blocks = doc.getMap('blocks');
  // A doc without a note has no body yet.
  const note = bodyNote(blocks);
  if (!note) return false;
  const descs = parseMarkdown(markdown);
  const pending = [];
  const children = note.get('sys:children');
  children.push(makeBlocks(blocks, descs, null, pending));
  applyMarks(pending);
  numberLists(blocks);
  return true;
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
  if (type === 'quote') return '> ' + text.split('\n').join('\n> ');
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

  const pending = [];
  doc.transact(() => {
    // Remove old content blocks, then rebuild the children list.
    for (const id of childIds) blocks.delete(id);
    childArr.delete(0, childArr.length);
    childArr.push(makeBlocks(blocks, descs, null, pending));
  });
  applyMarks(pending);
  numberLists(blocks);

  return Y.encodeStateAsUpdate(doc);
}

/**
 * Whether BlockSuite's table will accept `key` as an order key. Its table
 * sorts rows and columns with the fractional-indexing library, which rejects
 * any key whose fractional part ends in "0" (and the one smallest key); the
 * server's own tables used to be written with such keys (a000000, a000010…),
 * and next to one the editor could add no row or column. Mirrors the
 * library's validateOrderKey.
 */
export function validOrderKey(key) {
  if (typeof key !== 'string' || !/^[0-9A-Za-z]+$/.test(key)) return false;
  const head = key.charCodeAt(0);
  let intLen;
  if (head >= 97 && head <= 122) intLen = head - 97 + 2; // a..z
  else if (head >= 65 && head <= 90) intLen = 90 - head + 2; // A..Z
  else return false;
  if (key.length < intLen) return false;
  if (key === 'A' + '0'.repeat(26)) return false;
  return !key.slice(intLen).endsWith('0');
}

/**
 * Give every table in `doc` valid row and column order keys, keeping the
 * order the editor shows (code-point order of the old keys). Only a table
 * with at least one invalid key is touched, and then all of its rows (or
 * columns) are renumbered, so the result is a clean sequence. Returns how many
 * tables changed. Safe to run again: a fixed table has nothing invalid left.
 */
export function fixTableOrderKeys(doc) {
  const orderKey = (n) => 'a' + String(n).padStart(6, '0') + '1';
  let fixed = 0;
  doc.transact(() => {
    for (const [, b] of doc.getMap('blocks')) {
      if (!(b instanceof Y.Map) || b.get('sys:flavour') !== 'affine:table') continue;
      let changed = false;
      for (const kind of ['rows', 'columns']) {
        const re = new RegExp(`^prop:${kind}\\.(.+)\\.order$`);
        const entries = [];
        for (const k of b.keys()) {
          const m = re.exec(k);
          if (m) entries.push({ k, v: b.get(k) });
        }
        if (!entries.length || entries.every((e) => validOrderKey(e.v))) continue;
        entries.sort((x, y) => (String(x.v) > String(y.v) ? 1 : String(x.v) < String(y.v) ? -1 : 0));
        entries.forEach((e, i) => b.set(e.k, orderKey(i)));
        changed = true;
      }
      if (changed) fixed++;
    }
  });
  return fixed;
}

/** A stored state with its tables' order keys made valid (see above); the
 *  same bytes back when there was nothing to mend. For states copied in
 *  whole — a version restored as a new page, a draft — that would otherwise
 *  bring back keys the boot repair fixed. */
export function stateWithValidTableKeys(state) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(state));
  return fixTableOrderKeys(doc) ? Buffer.from(Y.encodeStateAsUpdate(doc)) : state;
}
