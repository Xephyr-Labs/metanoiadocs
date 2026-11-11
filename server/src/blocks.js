// Build a BlockSuite (0.22.4) Yjs doc state from markdown, entirely with plain
// yjs — no BlockSuite runtime. The block schema (flavours, versions, sys:/prop:
// keys, note defaults) mirrors what the editor produces natively, so a doc built
// here renders in the editor and syncs over Hocuspocus like any other.
import * as Y from 'yjs';
import { blockView, authorView, visibleOps } from './inline-suggest.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { cloneValue } from './restore.js';
import { renumberLists, syncText } from './suggestions.js';

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
  // A backslash makes the next markup character literal — how docToMarkdown
  // writes text that only looks like markdown (`\[[`, `\*`, a leading `\#`).
  { re: /\\([\\`*_~[\]<>#|.!+-])/, raw: true, attrs: () => ({}) },
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

/**
 * `[[key]]` → page id, over the pages `docs` ({id, title}) the writer can see.
 * The key is an id, `id|Title` (what linkLabeler writes for an ambiguous
 * title), or a title. A title two pages share resolves to nothing — the literal
 * stays visible rather than linking the wrong page.
 */
export function linkResolver(docs) {
  const ids = new Set(docs.map((d) => d.id));
  const byTitle = new Map();
  for (const d of docs) {
    const k = String(d.title ?? '').trim().toLowerCase();
    byTitle.set(k, byTitle.has(k) ? null : d.id);
  }
  return (key) => {
    const k = String(key).trim();
    const id = k.includes('|') ? k.slice(0, k.indexOf('|')).trim() : k;
    if (ids.has(id)) return id;
    return byTitle.get(k.toLowerCase()) ?? null;
  };
}

/**
 * Page id → the `[[key]]` label linkResolver reads back to the same page: the
 * title when it is unique, `id|Title` when it is not, and the bare id for a
 * page outside `docs`, so the link survives a rewrite without leaking a title.
 */
export function linkLabeler(docs) {
  const titles = new Map(docs.map((d) => [d.id, d.title]));
  const resolve = linkResolver(docs);
  return (pageId) => {
    const title = titles.get(pageId);
    // No title, or one the [[…]] syntax cannot hold: the id still links.
    if (title == null || !String(title).trim() || /[\]\n]/.test(title)) return pageId;
    return resolve(title) === pageId ? title : `${pageId}|${title}`;
  };
}

/** Every page a doc state @-references inline, deduped (the set doc_links stores). */
export function pageLinksOf(existing) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(existing));
  const ids = new Set();
  // Database cells nest their text (prop:cells → row → column → value); scan
  // as deep as the editor's own collectPageLinks does, or a headless write
  // would delete those backlinks.
  const scan = (v, depth) => {
    if (depth > 6) return;
    if (v instanceof Y.Text) {
      for (const op of visibleOps(v)) {
        const id = op.attributes?.reference?.pageId;
        if (typeof id === 'string' && id) ids.add(id);
      }
    } else if (v instanceof Y.Map || v instanceof Y.Array) {
      v.forEach((x) => scan(x, depth + 1));
    }
  };
  for (const [, b] of doc.getMap('blocks')) if (!(b instanceof Y.Map) || blockView(b)) scan(b, 0);
  return [...ids];
}

const LOSSY = {
  'affine:database': 'database', 'affine:attachment': 'attachment', 'affine:latex': 'equation',
  'affine:bookmark': 'embed', 'affine:frame': 'canvas', 'affine:edgeless-text': 'canvas',
};

/**
 * What a doc holds that its markdown cannot carry — a markdown replace would
 * delete it. Linked-doc cards are not on the list: they come back as inline
 * links, which keeps what they are for.
 */
export function lossyBlocks(existing) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(existing));
  const out = new Set();
  for (const [, b] of doc.getMap('blocks')) {
    if (!(b instanceof Y.Map) || !blockView(b)) continue;
    const fl = b.get('sys:flavour');
    if (LOSSY[fl]) out.add(LOSSY[fl]);
    else if (/^affine:embed-/.test(fl) && fl !== 'affine:embed-linked-doc' && fl !== 'affine:embed-synced-doc') out.add('embed');
    else if (fl === 'affine:note' && b.get('prop:displayMode') === 'edgeless') out.add('canvas');
    else if (fl === 'affine:surface') {
      const els = b.get('prop:elements');
      const value = els instanceof Y.Map ? els.get('value') : null;
      if (value instanceof Y.Map && value.size > 0) out.add('canvas');
    }
  }
  return [...out].sort();
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
export function extractText(existing, opts = {}) {
  const me = opts.withPendingFor ?? null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(existing));
  const blocks = doc.getMap('blocks');
  const get = (id) => blocks.get(id);
  const textOf = (b) => {
    const t = b.get('prop:text');
    return t instanceof Y.Text ? authorView(t, me) : '';
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
    const v = blockView(b, me);
    if (!v) return;
    const fl = v.flavour;
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

/** Blocks that only hold other blocks: walked through, never listed themselves. */
const CONTAINERS = new Set(['affine:page', 'affine:note', 'affine:surface', 'affine:callout', 'affine:frame']);

/** A non-text block's props as one comparable string — what it is, not where. */
function blockSig(b) {
  const out = [];
  for (const [k, v] of b) {
    if (!k.startsWith('prop:') || k === 'prop:mnSugg') continue;
    out.push([k, v instanceof Y.AbstractType ? v.toJSON() : v]);
  }
  return JSON.stringify(out.sort((x, y) => (x[0] < y[0] ? -1 : 1)));
}

/**
 * Decode a doc_states buffer to {title, blocks[]} with id/flavour/type/checked, tree order.
 * `opts.all` also lists the non-text blocks (images, tables, databases,
 * embeds…) with `sig`, a fingerprint of their props, so the History diff can
 * say one changed without reading inside it.
 */
export function extractBlocks(existing, opts = {}) {
  const me = opts.withPendingFor ?? null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(existing));
  const blocksMap = doc.getMap('blocks');
  const get = (id) => blocksMap.get(id);
  const textOf = (b) => {
    const t = b.get('prop:text');
    return t instanceof Y.Text ? authorView(t, me) : '';
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
    const v = blockView(b, me);
    if (!v) return;
    const fl = v.flavour;
    if (fl === 'affine:paragraph' || fl === 'affine:list' || fl === 'affine:code') {
      out.push({
        id: b.get('sys:id'),
        flavour: fl,
        type: v.type || 'text',
        checked: v.checked,
        text: textOf(b),
      });
    } else if (opts.all && !CONTAINERS.has(fl)) {
      out.push({ id: b.get('sys:id'), flavour: fl, type: v.type ?? null, checked: false, text: '', sig: blockSig(b) });
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
  for (const op of visibleOps(t, opts.withPendingFor ?? null)) {
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
    else if (opts.escape) s = escapeInline(s);
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

/** Plain text → markdown that parses back to the same text, not to markup. */
const escapeInline = (s) =>
  s.replace(/[\\`*~[]/g, '\\$&').replace(/__/g, '\\_\\_').replace(/<(?=\/?(?:span|u|mark|small|big)\b)/g, '\\<');

/** A paragraph whose text would open a block (list, heading, quote…) keeps it as text. */
const escapeLead = (md) => {
  if (/^\d+\.\s/.test(md)) return md.replace('.', '\\.');
  return /^(#{1,6}\s|>|[-+]\s|-{3,}\s*$|_{3,}\s*$|\||```|\$\$)/.test(md) ? `\\${md}` : md;
};

/** A table block's row and column ids, each in the order the editor shows them. */
export function tableAxes(b) {
  const rows = [];
  const cols = [];
  for (const key of b.keys()) {
    let m = key.match(/^prop:rows\.(.+)\.order$/);
    if (m) { rows.push({ id: m[1], order: String(b.get(key) ?? '') }); continue; }
    m = key.match(/^prop:columns\.(.+)\.order$/);
    if (m) cols.push({ id: m[1], order: String(b.get(key) ?? '') });
  }
  // By code point, as the editor sorts them (table-data-manager.ts). Fractional
  // keys mix cases — 'aZ' sorts before 'aa' — and localeCompare flips those.
  const byOrder = (x, y) => (x.order > y.order ? 1 : -1);
  return { rows: rows.sort(byOrder), cols: cols.sort(byOrder) };
}

/** A table block's flat prop keys → a markdown pipe table. */
function tableMarkdown(b, opts) {
  const { rows, cols } = tableAxes(b);
  if (!rows.length || !cols.length) return '';
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
 * `opts.escape` backslash-escapes text that would otherwise parse as markup,
 * for markdown that is written back (not for print/preview, which show it);
 * `opts.imageUrl(sourceId)` points image/attachment links at wherever the blob
 * is being served from.
 */
export function docToMarkdown(existing, opts = {}) {
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
  const kids = page?.get('sys:children');
  return { title, markdown: blocksToMarkdown(blocks, kids instanceof Y.Array ? kids.toArray() : [], opts) };
}

/** The subtrees under `rootIds`, in order, as markdown (docToMarkdown's walker). */
export function blocksToMarkdown(blocks, rootIds, opts = {}) {
  const imageUrl = opts.imageUrl || ((key) => `/api/blob/${encodeURIComponent(key)}`);
  // Parts, not lines: list items pack together, everything else gets a blank
  // line between it and its neighbour.
  let parts = [];
  const text = (b) => inlineMarkdown(b.get('prop:text'), opts);

  const walk = (id, depth) => {
    const b = blocks.get(id);
    if (!(b instanceof Y.Map)) return;
    const v = blockView(b, opts.withPendingFor ?? null);
    if (!v) return;
    const fl = v.flavour;
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
        const type = v.type || 'text';
        const body = text(b);
        if (/^h[1-6]$/.test(type)) parts.push({ text: `${'#'.repeat(Number(type[1]))} ${body}` });
        else if (type === 'quote') parts.push({ text: withSize(b, body).split('\n').map((l) => `> ${l}`).join('\n') });
        else parts.push({ text: withSize(b, opts.escape ? escapeLead(body) : body) });
        break;
      }
      case 'affine:list': {
        const type = v.type;
        const marker = type === 'numbered' ? '1.' : type === 'todo' ? `- [${v.checked ? 'x' : ' '}]` : '-';
        parts.push({ list: true, type, depth, text: `${'  '.repeat(depth)}${marker} ${withSize(b, text(b))}` });
        childDepth = depth + 1;
        break;
      }
      case 'affine:code':
        parts.push({ text: '```' + (b.get('prop:language') || '') + '\n' + (b.get('prop:text') instanceof Y.Text ? authorView(b.get('prop:text'), opts.withPendingFor ?? null) : '') + '\n```' });
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
      // A linked-doc card points at a page, not a url. Read back in it comes
      // as an inline reference — the link survives, the card styling does not.
      case 'affine:embed-linked-doc':
      case 'affine:embed-synced-doc': {
        const label = b.get('prop:pageId') && opts.resolveTitle?.(b.get('prop:pageId'));
        if (label) parts.push({ text: `[[${label}]]` });
        break;
      }
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

  for (const c of rootIds) walk(c, 0);

  // Trailing empty paragraphs are what an editor leaves behind, not content.
  return joinParts(parts);
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
export function bodyNote(blocks) {
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
export function appendMarkdownToDoc(doc, markdown, resolveLink, afterId) {
  const blocks = doc.getMap('blocks');
  // A doc without a note has no body yet.
  const note = bodyNote(blocks);
  if (!note) return false;
  const descs = parseMarkdown(markdown);
  const pending = [];
  const children = note.get('sys:children');
  const ids = makeBlocks(blocks, descs, resolveLink, pending);
  // `afterId`, a block of the body, puts them right after it instead of at the end.
  const at = afterId ? children.toArray().indexOf(afterId) : -1;
  if (at >= 0) children.insert(at + 1, ids);
  else children.push(ids);
  applyMarks(pending);
  numberLists(blocks);
  return true;
}

/**
 * Identity of a block for a replace: its subtree as canonical markdown, with
 * references by page id so a reference compares by target. Blocks that render
 * to nothing (empty paragraph, database…) only match their own kind.
 */
function blockKey(blocks, id) {
  const md = blocksToMarkdown(blocks, [id], { escape: true, resolveTitle: (pid) => pid });
  const b = blocks.get(id);
  return md || `\0${b?.get?.('sys:flavour')}:${b?.get?.('prop:type')}`;
}

const kidsOf = (b) => {
  const k = b instanceof Y.Map ? b.get('sys:children') : null;
  return k instanceof Y.Array ? k.toArray() : [];
};

export function dropTree(blocks, id, depth = 0) {
  if (depth > 200) return;
  for (const k of kidsOf(blocks.get(id))) dropTree(blocks, k, depth + 1);
  blocks.delete(id);
}

/** Copy a scratch subtree into the live doc under fresh ids; returns the new root id. */
export function copyTree(from, to, id) {
  const src = from.get(id);
  const newId = blockId();
  const m = new Y.Map();
  for (const [k, v] of src) {
    if (k === 'sys:id') m.set(k, newId);
    else if (k === 'sys:children') { const a = new Y.Array(); a.push(kidsOf(src).map((c) => copyTree(from, to, c))); m.set(k, a); }
    else m.set(k, cloneValue(v));
  }
  to.set(newId, m);
  return newId;
}

// What a block says, as opposed to how the editor lays it out (collapsed,
// width, xywh, textAlign, meta:*…) — those are only builder defaults in the
// scratch doc and must survive an edit. prop:order is set by renumberLists.
const CONTENT_PROPS = new Set(['prop:text', 'prop:type', 'prop:checked', 'prop:language', 'prop:mnSize',
  'prop:mnPanel', 'prop:sourceId', 'prop:latex', 'prop:url', 'prop:emoji']);
// Markdown carries a caption only for images, bookmarks and embeds; a code
// block's caption is editor-only and the builder's '' would wipe it.
const captioned = (fl) => fl === 'affine:image' || fl === 'affine:bookmark' || /^affine:embed-/.test(fl || '');
const isContent = (k, fl) =>
  CONTENT_PROPS.has(k) || /^prop:(rows|columns|cells)\./.test(k) || (k === 'prop:caption' && captioned(fl));

/**
 * Make live block `old` say what scratch block `neu` says, keeping its id and
 * its editor state. Content props are matched exactly (a dropped size tag or
 * table row goes); everything else is left alone. Equal content → no writes.
 */
function editInPlace(old, neu) {
  const fl = old.get('sys:flavour');
  for (const [k, v] of neu) {
    if (!isContent(k, fl)) continue;
    const cur = old.get(k);
    if (v instanceof Y.Text && cur instanceof Y.Text) syncText(cur, v);
    else if (v instanceof Y.AbstractType || cur !== v) old.set(k, cloneValue(v));
  }
  for (const k of [...old.keys()]) if (isContent(k, fl) && !neu.has(k)) old.delete(k);
}

/**
 * Turn `children` (a live sys:children array) into `newIds` (scratch blocks):
 * LCS on blockKey keeps matched blocks untouched; between matches, same
 * flavour+type pairs are edited in place (recursing into their children),
 * the rest of the old run is deleted and the rest of the new run copied in.
 */
function diffChildren(live, scratch, children, newIds) {
  const oldIds = children.toArray();
  const ok = oldIds.map((id) => blockKey(live, id));
  const nk = newIds.map((id) => blockKey(scratch, id));
  // ponytail: O(n·m) LCS table; fine for page-sized bodies, Myers if pages get huge.
  const n = ok.length, m = nk.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    L[i][j] = ok[i] === nk[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  }
  let i = 0, j = 0, pos = 0, moved = false;
  const flush = (iEnd, jEnd) => {
    // Pair the runs in order while their heads are the same kind of block.
    while (i < iEnd && j < jEnd) {
      const o = live.get(oldIds[i]), nb = scratch.get(newIds[j]);
      if (!(o instanceof Y.Map) || o.get('sys:flavour') !== nb.get('sys:flavour') || o.get('prop:type') !== nb.get('prop:type')) break;
      editInPlace(o, nb);
      if (!(o.get('sys:children') instanceof Y.Array)) o.set('sys:children', new Y.Array());
      diffChildren(live, scratch, o.get('sys:children'), kidsOf(nb));
      i++; j++; pos++;
    }
    if (iEnd > i) {
      children.delete(pos, iEnd - i);
      moved = true;
      for (; i < iEnd; i++) dropTree(live, oldIds[i]);
    }
    if (jEnd > j) {
      const ids = newIds.slice(j, jEnd).map((id) => copyTree(scratch, live, id));
      children.insert(pos, ids);
      moved = true;
      pos += ids.length;
      j = jEnd;
    }
  };
  let a = 0, b = 0;
  while (a < n && b < m) {
    if (ok[a] === nk[b]) { flush(a, b); i++; j++; pos++; a++; b++; }
    else if (L[a + 1][b] >= L[a][b + 1]) a++;
    else b++;
  }
  flush(n, m);
  if (moved) renumberLists(live, children.toArray());
}

/**
 * Replace a LIVE doc's body with `markdown`, block by block: unchanged blocks
 * keep their ids, edited ones are edited in place, only new ones get new ids —
 * so a review of the result lists what actually changed. The page block,
 * surface and title are left alone. Call inside the caller's transaction.
 *
 * @returns {boolean} false if the doc has no body note (build it from scratch).
 */
export function replaceBodyKeepingIds(doc, title, markdown, resolveLink) {
  const live = doc.getMap('blocks');
  const note = bodyNote(live);
  if (!note) return false;
  const scratchDoc = new Y.Doc();
  Y.applyUpdate(scratchDoc, buildDocState(title, markdown, resolveLink));
  const scratch = scratchDoc.getMap('blocks');
  if (!(note.get('sys:children') instanceof Y.Array)) note.set('sys:children', new Y.Array());
  diffChildren(live, scratch, note.get('sys:children'), kidsOf(bodyNote(scratch)));
  // Marks came across inside the copied texts; numbering is positional.
  numberLists(live);
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
    // A rebuild would silently accept or lose what is pending.
    const bt = b.get('prop:text');
    if (b.get('prop:mnSugg') || (bt instanceof Y.Text && bt.toDelta().some((op) => op.attributes?.mnSugg))) return null;
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

// ── Slides ──────────────────────────────────────────────────────────────────
//
// A slide is what web-react/src/editor/slides.ts addSlide() makes: an
// affine:frame on the surface, 1600x900, a white sheet titled in prop:title,
// with an affine:edgeless-text holding an h1 inside its bound and listed in the
// frame's childElementIds. Slides sit in a row, 160 apart, ordered by
// prop:presentationIndex. The props below are the 0.22.4 schema defaults the
// editor writes for those two flavours, so a slide built here is the same
// blocks as one made by the Slides button.

export const SLIDE_W = 1600;
export const SLIDE_H = 900;
const SLIDE_GAP = 160;
const TITLE_PAD = 110;
const TITLE_H = 120;
/** Top of the body box: under the title, inside the slide's margins. */
const BODY_Y = TITLE_PAD + TITLE_H + 40;

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const intPart = (key) => {
  const h = key.charCodeAt(0);
  return key.slice(0, h >= 97 ? h - 97 + 2 : 90 - h + 2);
};
/** fractional-indexing's integer step, up (+1) or down (-1). */
function stepInteger(x, dir) {
  const [head, ...digs] = x;
  const edge = dir > 0 ? 'z' : '0';
  let i = digs.length - 1;
  for (; i >= 0 && digs[i] === edge; i--) digs[i] = dir > 0 ? '0' : 'z';
  if (i >= 0) {
    digs[i] = DIGITS[DIGITS.indexOf(digs[i]) + dir];
    return head + digs.join('');
  }
  // Carried out of the digits: the head moves and the integer grows or shrinks.
  if (dir > 0 && head === 'Z') return 'a0';
  if (dir < 0 && head === 'a') return 'Zz';
  const h = String.fromCharCode(head.charCodeAt(0) + dir);
  if (dir > 0 ? h > 'a' : h < 'Z') digs.push(dir > 0 ? '0' : 'z');
  else digs.pop();
  return h + digs.join('');
}
/** generateKeyBetween(a, null) and generateKeyBetween(null, b).
 *  ponytail: no insert-between; slides are only ever appended. */
export const keyAfter = (a) => (a ? stepInteger(intPart(a), 1) : 'a0');
export const keyBefore = (b) => {
  if (!b) return 'a0';
  const ib = intPart(b);
  return ib < b ? ib : stepInteger(ib, -1);
};
/** BlockSuite's generateKeyBetweenV2(last, null): an integer key, '0', 32 random chars. */
function presentationKeyAfter(last) {
  const sub = last && last.length > 33 ? last.slice(0, -33) : last;
  const chars = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const tail = [...crypto.randomBytes(32)].map((n) => chars[n % chars.length]).join('');
  return keyAfter(sub || null) + '0' + tail;
}

const xywhOf = (s) => {
  try {
    const a = JSON.parse(s);
    return Array.isArray(a) && a.length === 4 && a.every(Number.isFinite) ? a : null;
  } catch {
    return null;
  }
};

/** The page's surface, made if the page has none. */
function surfaceOf(blocks) {
  const found = [...blocks.values()].find((b) => b instanceof Y.Map && b.get('sys:flavour') === 'affine:surface');
  if (found) return found;
  const page = [...blocks.values()].find((b) => b instanceof Y.Map && b.get('sys:flavour') === 'affine:page');
  if (!page) throw new Error('not a page');
  const id = makeSurface(blocks);
  page.get('sys:children').insert(0, [id]);
  return blocks.get(id);
}

/** Every z-index (sorted) and bound on the canvas: notes, surface blocks, surface elements. */
function canvasExtent(blocks, surface) {
  const indexes = [];
  const bounds = [];
  const take = (index, xywh) => {
    if (validOrderKey(index)) indexes.push(index);
    const r = xywhOf(xywh);
    if (r) bounds.push(r);
  };
  const onSurface = new Set(kidsOf(surface));
  for (const [id, b] of blocks) {
    if (b instanceof Y.Map && (b.get('sys:flavour') === 'affine:note' || onSurface.has(id))) {
      take(b.get('prop:index'), b.get('prop:xywh'));
    }
  }
  const els = surface.get('prop:elements');
  const value = els instanceof Y.Map ? els.get('value') : null;
  if (value instanceof Y.Map) for (const [, e] of value) if (e instanceof Y.Map) take(e.get('index'), e.get('xywh'));
  indexes.sort();
  return { indexes, bounds };
}

/** Frames in presentation order: EdgelessFrameManager.framePresentationComparator. */
function framesOf(blocks) {
  const frames = [...blocks.values()].filter((b) => b instanceof Y.Map && b.get('sys:flavour') === 'affine:frame');
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return frames.sort((a, b) => {
    const pa = a.get('prop:presentationIndex');
    const pb = b.get('prop:presentationIndex');
    if (pa && pb) return cmp(pa, pb);
    if (pa || pb) return pa ? -1 : 1;
    return cmp(String(a.get('prop:index')), String(b.get('prop:index')));
  });
}

const themed = (light, dark) => {
  const m = new Y.Map();
  m.set('light', light);
  m.set('dark', dark);
  return m;
};

/** An affine:edgeless-text on the surface holding `childIds`, with the schema's defaults. */
function makeEdgelessText(blocks, surface, xywh, index, childIds, hasMaxWidth) {
  const id = blockId();
  const t = new Y.Map();
  t.set('sys:id', id);
  t.set('sys:flavour', 'affine:edgeless-text');
  t.set('sys:version', 1);
  const kids = new Y.Array();
  kids.push(childIds);
  t.set('sys:children', kids);
  t.set('prop:xywh', `[${xywh.join(',')}]`);
  t.set('prop:index', index);
  t.set('prop:lockedBySelf', false);
  t.set('prop:scale', 1);
  t.set('prop:rotate', 0);
  t.set('prop:hasMaxWidth', hasMaxWidth);
  t.set('prop:color', themed('#000000', '#ffffff'));
  t.set('prop:fontFamily', 'blocksuite:surface:Inter');
  t.set('prop:fontStyle', 'normal');
  t.set('prop:fontWeight', '400');
  t.set('prop:textAlign', 'left');
  blocks.set(id, t);
  surface.get('sys:children').push([id]);
  return id;
}

/** Markdown as what an edgeless-text may hold (its schema's children); the rest as text. */
const slideBodyDescs = (markdown) => parseMarkdown(markdown).flatMap((d) => {
  if (d.flavour === 'affine:paragraph' || d.flavour === 'affine:list' || d.flavour === 'affine:code') return [d];
  if (d.flavour === 'affine:callout') return [calloutAsQuote(d)];
  if (d.flavour === 'affine:image') return [imageAsParagraph(d)];
  if (d.flavour === 'affine:table') return d.rows.map((r) => ({ flavour: 'affine:paragraph', type: 'text', text: r.join(' | ') }));
  return []; // a divider has no place in a text box
});

/** The body box under a slide's title, filled with `markdown`. */
function addSlideBody(blocks, surface, frame, markdown, resolveLink) {
  const descs = slideBodyDescs(markdown);
  if (!descs.length) return null;
  const [x, y, w, h] = xywhOf(frame.get('prop:xywh'));
  const pending = [];
  const ids = makeBlocks(blocks, descs, resolveLink, pending);
  const { indexes } = canvasExtent(blocks, surface);
  const id = makeEdgelessText(blocks, surface, [x + TITLE_PAD, y + BODY_Y, w - TITLE_PAD * 2, h - BODY_Y - TITLE_PAD],
    keyAfter(indexes.at(-1)), ids, true);
  applyMarks(pending);
  numberLists(blocks);
  frame.get('prop:childElementIds').set(id, true);
  return id;
}

/**
 * Append a slide to a LIVE doc (the same contract as appendMarkdownToDoc): a
 * frame after the last one, or clear of whatever is on the canvas, with the
 * title box addSlide() makes, its h1 holding `title`, and `body` markdown in a
 * text box below it. Returns the frame id.
 */
export function addSlideToDoc(doc, { title, body } = {}, resolveLink) {
  const blocks = doc.getMap('blocks');
  const surface = surfaceOf(blocks);
  const frames = framesOf(blocks);
  const last = frames.at(-1);
  const { indexes, bounds } = canvasExtent(blocks, surface);
  let x = 0;
  let y = 0;
  const prev = last && xywhOf(last.get('prop:xywh'));
  if (prev) {
    x = prev[0] + prev[2] + SLIDE_GAP;
    y = prev[1];
  } else if (bounds.length) {
    // Clear of the page's note, as addSlide does with gfx.elementsBound.
    x = Math.max(...bounds.map((r) => r[0] + r[2])) + SLIDE_GAP;
    y = Math.min(...bounds.map((r) => r[1]));
  }
  // Numbered past the highest "Slide N" there has been, as addSlide does.
  const highest = frames.reduce((max, f) => {
    const n = /^Slide (\d+)$/.exec(String(f.get('prop:title') ?? '').trim())?.[1];
    return n ? Math.max(max, Number(n)) : max;
  }, frames.length);
  const name = String(title ?? '').trim();

  const id = blockId();
  const frame = new Y.Map();
  frame.set('sys:id', id);
  frame.set('sys:flavour', 'affine:frame');
  frame.set('sys:version', 1);
  frame.set('sys:children', new Y.Array());
  frame.set('prop:title', plainYText(name || `Slide ${highest + 1}`));
  frame.set('prop:background', themed('#ffffff', '#252525'));
  frame.set('prop:xywh', `[${x},${y},${SLIDE_W},${SLIDE_H}]`);
  // Under everything else, as gfx.layer.generateIndex(true) puts a frame.
  frame.set('prop:index', keyBefore(indexes[0]));
  frame.set('prop:childElementIds', new Y.Map());
  frame.set('prop:presentationIndex', presentationKeyAfter(last?.get('prop:presentationIndex') || null));
  frame.set('prop:lockedBySelf', false);
  blocks.set(id, frame);
  surface.get('sys:children').push([id]);

  const h1 = makeBlock(blocks, { flavour: 'affine:paragraph', type: 'h1', text: '' }, null, null);
  blocks.get(h1).get('prop:text').insert(0, name);
  const titleBox = makeEdgelessText(blocks, surface, [x + TITLE_PAD, y + TITLE_PAD, SLIDE_W - TITLE_PAD * 2, TITLE_H],
    keyAfter(indexes.at(-1)), [h1], false);
  frame.get('prop:childElementIds').set(titleBox, true);
  if (body) addSlideBody(blocks, surface, frame, body, resolveLink);
  return id;
}

/** A slide's text boxes, top first: the title box (first h1 box) and the rest. */
function slideBoxes(blocks, frame) {
  const owned = frame.get('prop:childElementIds');
  const boxes = (owned instanceof Y.Map ? [...owned.keys()] : [])
    .map((id) => blocks.get(id))
    .filter((b) => b instanceof Y.Map && b.get('sys:flavour') === 'affine:edgeless-text')
    .sort((a, b) => (xywhOf(a.get('prop:xywh'))?.[1] ?? 0) - (xywhOf(b.get('prop:xywh'))?.[1] ?? 0));
  const titleBox = boxes.find((b) => {
    const first = blocks.get(kidsOf(b)[0]);
    return first?.get('sys:flavour') === 'affine:paragraph' && first.get('prop:type') === 'h1';
  }) ?? null;
  return { titleBox, bodyBoxes: boxes.filter((b) => b !== titleBox) };
}

/** Every slide in presentation order, as { id, title, body } with the body as markdown. */
export function listSlides(existing) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(existing));
  const blocks = doc.getMap('blocks');
  return framesOf(blocks).map((f, i) => ({
    id: f.get('sys:id'),
    title: String(f.get('prop:title') ?? '').trim() || `Slide ${i + 1}`,
    body: slideBoxes(blocks, f).bodyBoxes.map((b) => blocksToMarkdown(blocks, kidsOf(b))).filter(Boolean).join('\n\n'),
  }));
}

/**
 * Text on the canvas that no slide carries — free text boxes and notes set to
 * edgeless-only — as markdown, top to bottom then left to right. Page markdown
 * skips the canvas, so without this a doc built on it reads back empty.
 */
export function looseCanvasMarkdown(existing, opts = {}) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(existing));
  const blocks = doc.getMap('blocks');
  const onSlide = new Set(framesOf(blocks).flatMap((f) => {
    const owned = f.get('prop:childElementIds');
    return owned instanceof Y.Map ? [...owned.keys()] : [];
  }));
  const at = (b) => xywhOf(b.get('prop:xywh')) ?? [0, 0];
  return [...blocks.values()]
    .filter((b) => b instanceof Y.Map && blockView(b) && (
      (b.get('sys:flavour') === 'affine:edgeless-text' && !onSlide.has(b.get('sys:id'))) ||
      (b.get('sys:flavour') === 'affine:note' && b.get('prop:displayMode') === 'edgeless')))
    .sort((a, b) => at(a)[1] - at(b)[1] || at(a)[0] - at(b)[0])
    .map((b) => blocksToMarkdown(blocks, kidsOf(b), opts))
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Change a slide's title and/or body in a LIVE doc. A title goes to the frame
 * (what the deck rail shows) and its title box; a body replaces every other
 * text box the slide owns. False when `slideId` is not a slide.
 */
export function updateSlideInDoc(doc, slideId, { title, body } = {}, resolveLink) {
  const blocks = doc.getMap('blocks');
  const frame = blocks.get(slideId);
  if (!(frame instanceof Y.Map) || frame.get('sys:flavour') !== 'affine:frame') return false;
  const surface = surfaceOf(blocks);
  const { titleBox, bodyBoxes } = slideBoxes(blocks, frame);
  if (typeof title === 'string') {
    frame.set('prop:title', plainYText(title.trim()));
    const t = titleBox && blocks.get(kidsOf(titleBox)[0])?.get('prop:text');
    if (t instanceof Y.Text) {
      t.delete(0, t.length);
      t.insert(0, title.trim());
    }
  }
  if (typeof body === 'string') {
    const kids = surface.get('sys:children');
    for (const box of bodyBoxes) {
      const id = box.get('sys:id');
      const at = kids.toArray().indexOf(id);
      if (at >= 0) kids.delete(at, 1);
      frame.get('prop:childElementIds').delete(id);
      dropTree(blocks, id);
    }
    addSlideBody(blocks, surface, frame, body, resolveLink);
  }
  return true;
}

/** A new deck: buildDocState's page, then `slides` appended. */
export function buildDeckState(title, markdown, slides, resolveLink) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, buildDocState(title, markdown, resolveLink));
  for (const s of slides) addSlideToDoc(doc, s, resolveLink);
  return Y.encodeStateAsUpdate(doc);
}
