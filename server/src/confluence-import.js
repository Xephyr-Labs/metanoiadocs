// Confluence space export (Space tools → Export → HTML) → pages.
//
// The export is a zip: `index.html` (a site map: the page tree as nested
// lists), one `<Title>_<id>.html` per page, and `attachments/<pageId>/<file>`.
// Each page's body sits in `#main-content`; everything around it (breadcrumbs,
// byline, attachment list) is chrome that we read for structure and drop.
//
// Output is the markdown the rest of the app speaks, one string per page, so
// the shared pipeline (archive-import.js → createDocRow → buildDocState) does
// the rest. What markdown can hold decides what survives: headings, lists,
// tasks, pipe tables, fenced code, quotes, images by blob, and GitHub-style
// panels (the editor's callout block). There is no toggle block, so an "expand"
// macro keeps its title in bold above its content.
//
// The HTML parser is the same bargain docx-import.js strikes for XML: Confluence
// writes its export mechanically, so a small tolerant tree builder beats a
// dependency. Unknown elements are walked through, never rejected.

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  bull: '•', middot: '·', laquo: '«', raquo: '»', rarr: '→', larr: '←', times: '×', deg: '°',
};

function decode(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style']);
// A tag that implicitly ends the open one of these kinds — the optional end
// tags HTML allows, which hand-written HTML (and old Confluence themes) use.
const BLOCKS_END_P = ['div', 'ul', 'ol', 'table', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr', 'p'];
const AUTO = {
  li: ['li'], td: ['td', 'th'], th: ['td', 'th'], tr: ['tr', 'td', 'th'],
  ...Object.fromEntries(BLOCKS_END_P.map((t) => [t, ['p']])),
};

function attrsOf(src) {
  const out = {};
  const re = /([^\s=\/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(src))) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

/** HTML → `{tag, attrs, children, parent}` nodes; text is a string child. */
export function parseHtml(src) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<\/([A-Za-z][\w:-]*)\s*>|<([A-Za-z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let last = 0;
  let m;
  const text = (t) => { if (t) cur.children.push(decode(t)); };
  while ((m = re.exec(src))) {
    text(src.slice(last, m.index));
    last = re.lastIndex;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      for (let n = cur; n && n !== root; n = n.parent) if (n.tag === tag) { cur = n.parent; break; }
    } else if (m[2]) {
      const tag = m[2].toLowerCase();
      while (AUTO[tag]?.includes(cur.tag)) cur = cur.parent;
      const node = { tag, attrs: attrsOf(m[3]), children: [], parent: cur };
      cur.children.push(node);
      if (RAW.has(tag)) {
        const end = src.toLowerCase().indexOf(`</${tag}`, re.lastIndex);
        const close = end < 0 ? -1 : src.indexOf('>', end);
        re.lastIndex = last = close < 0 ? src.length : close + 1;
      } else if (!VOID.has(tag) && !/\/\s*$/.test(m[3])) cur = node;
    }
  }
  text(src.slice(last));
  return root;
}

const isEl = (n) => typeof n !== 'string';
const classes = (n) => new Set((n.attrs?.class || '').split(/\s+/).filter(Boolean));
const hasClass = (n, c) => isEl(n) && classes(n).has(c);
const textOf = (n) => (isEl(n) ? n.children.map(textOf).join('') : n);

function find(n, pred) {
  if (!isEl(n)) return null;
  for (const c of n.children) {
    if (isEl(c) && pred(c)) return c;
    const hit = find(c, pred);
    if (hit) return hit;
  }
  return null;
}
function findAll(n, pred, out = []) {
  if (!isEl(n)) return out;
  for (const c of n.children) {
    if (isEl(c) && pred(c)) out.push(c);
    findAll(c, pred, out);
  }
  return out;
}

// ── paths ──────────────────────────────────────────────────────────────────

const dirOf = (p) => p.slice(0, p.lastIndexOf('/') + 1);

/** `a/b/../c` → `a/c`; null when it climbs out of the archive. */
export function joinPath(dir, rel) {
  const out = [];
  for (const seg of (dir + rel).split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (!out.length) return null; out.pop(); } else out.push(seg);
  }
  return out.join('/');
}

/** The archive key an href points at, relative to `fromDir`; null when it isn't one. */
function fileFor(href, fromDir, lookup) {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('//')) return null;
  let rel = href.split('#')[0].split('?')[0];
  try { rel = decodeURIComponent(rel); } catch { /* keep as written */ }
  const path = joinPath(rel.startsWith('/') ? '' : fromDir, rel);
  return path == null ? null : lookup(path);
}

// ── HTML → markdown ────────────────────────────────────────────────────────

// The macros this file turns into something deliberate. Any other
// `conf-macro` is reported by name; its text is kept either way.
const KNOWN_MACROS = new Set(['code', 'noformat', 'info', 'note', 'warning', 'tip', 'expand', 'panel', 'toc', 'anchor', 'status']);
const PANELS = { information: 'INFO', info: 'INFO', note: 'NOTE', warning: 'WARNING', tip: 'TIP' };
const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table', 'pre', 'blockquote', 'hr', 'dl', 'section', 'article', 'header', 'footer', 'figure', 'details', 'center']);

// Markdown's own punctuation, so prose that merely looks like markup stays prose.
const esc = (s) => s.replace(/[\\`*_~[\]<>]/g, '\\$&');
const escLead = (s) => s
  .replace(/^(#{1,6}\s)/, '\\$1').replace(/^([-+*>])/, '\\$1').replace(/^(\d+)\./, '$1\\.');
const linkUrl = (u) => u.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');

/**
 * Convert one page's body. `c` carries what the walk needs from outside:
 * `fromDir`, `lookup` (path → archive key), `pageId(file)`, `urlOf(key)` (blobs
 * already saved), and the `report` counters.
 */
function convert(root, c) {
  const flat = { ...c, flat: true };

  function inline(nodes, cx = c) {
    let out = '';
    for (const n of nodes) {
      if (!isEl(n)) { out += esc(n.replace(/\s+/g, ' ')); continue; }
      const kids = () => inline(n.children, cx);
      switch (n.tag) {
        case 'script': case 'style': case 'head': break;
        case 'br': out += ' '; break;
        case 'strong': case 'b': { const t = kids().trim(); out += t ? `**${t}**` : ''; break; }
        case 'em': case 'i': { const t = kids().trim(); out += t ? `*${t}*` : ''; break; }
        case 'del': case 's': case 'strike': { const t = kids().trim(); out += t ? `~~${t}~~` : ''; break; }
        case 'u': { const t = kids().trim(); out += t ? `<u>${t}</u>` : ''; break; }
        case 'code': case 'tt': case 'kbd': {
          const t = textOf(n);
          out += t.trim() && !t.includes('`') ? `\`${t.replace(/\s+/g, ' ')}\`` : esc(t);
          break;
        }
        case 'a': out += anchor(n, kids(), cx); break;
        case 'img': out += image(n, cx); break;
        default:
          if (isEl(n) && n.tag === 'span' && macroName(n)) countMacro(n);
          out += kids() + (BLOCK_TAGS.has(n.tag) ? ' ' : '');
      }
    }
    return out;
  }

  function macroName(n) {
    if (!hasClass(n, 'conf-macro')) return null;
    const name = (n.attrs['data-macro-name'] || '').toLowerCase();
    return name && !KNOWN_MACROS.has(name) ? name : null;
  }
  function countMacro(n) {
    const name = macroName(n);
    if (name) c.report.macros[name] = (c.report.macros[name] || 0) + 1;
  }

  function anchor(n, text, cx) {
    const href = n.attrs.href || '';
    const label = text.trim();
    if (/^(https?:|mailto:)/i.test(href)) return label ? `[${label}](${linkUrl(href)})` : '';
    if (!href || href.startsWith('#')) return text;
    const key = fileFor(href, c.fromDir, c.lookup);
    if (key) {
      const id = c.pageId(key);
      if (id) return `[[${id}]]`;
      const url = c.urlOf(key);
      if (url) { c.used.add(key); return `[${label || key.split('/').pop()}](${url})`; }
    }
    c.report.unresolved.push(href.split('?')[0]);
    return text;
  }

  function image(n, cx) {
    const cls = classes(n);
    // Emoticons carry their glyph; the site's own icons and spacers are chrome.
    if (cls.has('emoticon')) return n.attrs['data-emoji-fallback'] || esc(n.attrs.alt || '');
    const src = n.attrs['data-image-src'] || n.attrs.src || '';
    if (/(^|\/)images\/icons\//.test(src)) return '';
    const alt = (n.attrs.alt || '').replace(/[\]\n]/g, ' ').trim();
    const key = fileFor(src, c.fromDir, c.lookup);
    const url = key && c.urlOf(key);
    if (!url) {
      if (key || !/^https?:/i.test(src)) c.report.unresolved.push(src.split('?')[0]);
      return /^https?:/i.test(src) ? `[${alt || 'image'}](${linkUrl(src)})` : esc(alt);
    }
    c.used.add(key);
    // An image block must be alone on its line; in a list item or table cell
    // there is no such line, so it becomes a link to the picture.
    return cx.flat ? `[${alt || key.split('/').pop()}](${url})` : `\n\n![${alt}](${url})\n\n`;
  }

  function blocks(nodes) {
    const out = [];
    let run = [];
    const flush = () => {
      const t = inline(run).replace(/[ \t]*\n[ \t]*\n[ \t]*/g, '\n\n').trim();
      run = [];
      for (const part of t.split(/\n\n+/)) if (part.trim()) out.push(part.startsWith('![') ? part.trim() : escLead(part.trim()));
    };
    for (const n of nodes) {
      if (isEl(n) && (BLOCK_TAGS.has(n.tag))) { flush(); out.push(...block(n)); } else run.push(n);
    }
    flush();
    return out;
  }

  const quote = (head, body) => [...(head ? [head] : []), ...body.join('\n\n').split('\n')]
    .map((l) => (l ? `> ${l}` : '>')).join('\n');

  function block(n) {
    const h = /^h([1-6])$/.exec(n.tag);
    if (h) { const t = inline(n.children, flat).trim(); return t ? [`${'#'.repeat(h[1])} ${t}`] : []; }
    switch (n.tag) {
      case 'hr': return ['---'];
      case 'ul': case 'ol': return [list(n, 0).join('\n')];
      case 'table': return table(n);
      case 'pre': return [fence(n)];
      case 'blockquote': { const b = blocks(n.children); return b.length ? [quote(null, b)] : []; }
      case 'div': return div(n);
      default: return blocks(n.children);
    }
  }

  function div(n) {
    const cls = classes(n);
    const panelKind = [...cls].map((k) => /^confluence-information-macro-(\w+)$/.exec(k)?.[1]).find((k) => k && PANELS[k]);
    if (panelKind) {
      const body = find(n, (x) => hasClass(x, 'confluence-information-macro-body')) || n;
      const title = find(n, (x) => hasClass(x, 'confluence-information-macro-title'));
      const inner = blocks(body.children);
      if (title) inner.unshift(`**${inline(title.children, flat).trim()}**`);
      return [quote(`[!${PANELS[panelKind]}]`, inner.length ? inner : [''])];
    }
    if (cls.has('expand-container')) {
      const title = textOf(find(n, (x) => hasClass(x, 'expand-control-text')) || '').trim();
      const body = find(n, (x) => hasClass(x, 'expand-content'));
      return [...(title ? [`**${esc(title)}**`] : []), ...blocks(body ? body.children : [])];
    }
    if (cls.has('panel') && !cls.has('code')) {
      const head = find(n, (x) => hasClass(x, 'panelHeader'));
      const body = find(n, (x) => hasClass(x, 'panelContent'));
      const inner = blocks(body ? body.children : n.children);
      if (head) inner.unshift(`**${inline(head.children, flat).trim()}**`);
      return inner.length ? [quote(null, inner)] : [];
    }
    countMacro(n);
    return blocks(n.children);
  }

  function fence(n) {
    const host = [n, n.parent, n.parent?.parent].find((x) => x?.attrs?.['data-syntaxhighlighter-params']);
    const lang = /brush:\s*([\w+#-]+)/.exec(host?.attrs['data-syntaxhighlighter-params'] || '')?.[1] || '';
    const code = textOf(n).replace(/\n$/, '').split('\n')
      // A fence line inside the code would close ours early; a leading space keeps it literal.
      .map((l) => (/^```/.test(l) ? ` ${l}` : l)).join('\n');
    return `\`\`\`${lang.toLowerCase().replace(/\W/g, '')}\n${code}\n\`\`\``;
  }

  function list(n, depth) {
    const lines = [];
    let i = 0;
    const tasks = hasClass(n, 'inline-task-list') || hasClass(n, 'task-list');
    for (const li of n.children.filter((x) => isEl(x) && x.tag === 'li')) {
      i++;
      const text = inline(li.children.filter((x) => !(isEl(x) && (x.tag === 'ul' || x.tag === 'ol'))), flat).replace(/\s+/g, ' ').trim();
      const nested = li.children.filter((x) => isEl(x) && (x.tag === 'ul' || x.tag === 'ol'));
      const mark = tasks ? `- [${hasClass(li, 'checked') ? 'x' : ' '}] ` : n.tag === 'ol' ? `${i}. ` : '- ';
      if (text || nested.length) lines.push(`${'  '.repeat(depth)}${mark}${escLead(text)}`.trimEnd());
      for (const sub of nested) lines.push(...list(sub, depth + 1));
    }
    return lines;
  }

  function table(n) {
    const rows = [];
    const collect = (x) => {
      for (const ch of x.children) {
        if (!isEl(ch)) continue;
        if (ch.tag === 'tr') rows.push(ch.children.filter((k) => isEl(k) && (k.tag === 'td' || k.tag === 'th')));
        else if (ch.tag !== 'table') collect(ch);
      }
    };
    collect(n);
    const cells = rows.map((r) => r.map((cell) => inline(cell.children, flat).replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')));
    const width = Math.max(0, ...cells.map((r) => r.length));
    if (!width) return [];
    const line = (r) => `| ${[...r, ...Array(width - r.length).fill('')].join(' | ')} |`;
    return [[line(cells[0]), line(Array(width).fill('---')), ...cells.slice(1).map(line)].join('\n')];
  }

  return blocks(root.children).join('\n\n');
}

// ── the export as a whole ──────────────────────────────────────────────────

const titleOf = (doc, spaceName) => {
  const raw = (textOf(find(doc, (n) => n.attrs?.id === 'title-text') || find(doc, (n) => n.tag === 'title') || '')).replace(/\s+/g, ' ').trim();
  // Pages are titled "SPACE : Page"; the prefix is the space, not the page.
  return (spaceName && raw.startsWith(`${spaceName} : `) ? raw.slice(spaceName.length + 3) : raw).slice(0, 200) || 'Untitled';
};

/**
 * @param {Map<string, Buffer>} files  archive path → bytes
 * @param {{store: {url(key): Promise<string|null>}, newId(): string, report: object, rootName: string}} deps
 * @returns {Promise<{folders: object[], pages: object[]}>}
 */
export async function planConfluence(files, { store, newId, report, rootName }) {
  const indexKey = [...files.keys()].filter((k) => /(^|\/)index\.html$/i.test(k)).sort((a, b) => a.length - b.length)[0];
  if (!indexKey) throw new Error('This does not look like a Confluence HTML export: it has no index.html.');
  const base = dirOf(indexKey);

  const lower = new Map([...files.keys()].map((k) => [k.toLowerCase(), k]));
  const lookup = (p) => (files.has(p) ? p : lower.get(p.toLowerCase()) ?? null);
  const pageFiles = [...files.keys()].filter((k) => k.startsWith(base) && !k.slice(base.length).includes('/')
    && /\.html?$/i.test(k) && k !== indexKey);
  const isPage = new Set(pageFiles);
  const read = (k) => parseHtml(files.get(k).toString('utf8'));

  // Pass 1: structure only. The trees are dropped again so a big space is
  // never held in memory whole.
  const meta = new Map();
  let spaceName = '';
  for (const key of pageFiles) {
    const doc = read(key);
    const crumbs = findAll(find(doc, (n) => n.attrs?.id === 'breadcrumbs') || { children: [] }, (n) => n.tag === 'a');
    spaceName ||= textOf(crumbs[0] || '').trim();
    const up = crumbs.length > 1 ? fileFor(crumbs[crumbs.length - 1].attrs.href, base, lookup) : null;
    meta.set(key, { crumbParent: up && isPage.has(up) && up !== key ? up : null });
  }
  for (const [key, m] of meta) m.title = titleOf(read(key), spaceName);

  // The site map is the authority on the tree: a page's parent is the page of
  // the list item it is nested in. Breadcrumbs fill in for pages it omits.
  const parentOf = new Map();
  const order = [];
  const walk = (node, parent) => {
    for (const ch of node.children) {
      if (!isEl(ch)) continue;
      let next = parent;
      if (ch.tag === 'li') {
        const a = ch.children.find((k) => isEl(k) && k.tag === 'a') || ch.children.map((k) => isEl(k) && find(k, (x) => x.tag === 'a')).find(Boolean);
        const key = a && fileFor(a.attrs.href, base, lookup);
        if (key && isPage.has(key) && !parentOf.has(key)) { parentOf.set(key, parent); order.push(key); next = key; }
      }
      walk(ch, next);
    }
  };
  walk(read(indexKey), null);
  for (const key of pageFiles) if (!parentOf.has(key)) { parentOf.set(key, meta.get(key).crumbParent); order.push(key); }
  // A parent chain that loops back on itself (a corrupt export) is cut, not followed.
  for (const key of pageFiles) {
    const seen = new Set([key]);
    for (let p = parentOf.get(key); p; p = parentOf.get(p)) {
      if (seen.has(p)) { parentOf.set(key, null); break; }
      seen.add(p);
    }
  }

  const ids = new Map(pageFiles.map((k) => [k, newId()]));
  const rootId = newId();
  const children = new Map();
  for (const key of order) {
    const p = parentOf.get(key);
    if (p) children.set(p, [...(children.get(p) || []), key]);
  }

  // Pass 2: bodies. Blobs are saved first (the walk itself is synchronous), and
  // only for files a page actually refers to or lists.
  const pages = [];
  for (const key of order) {
    const doc = read(key);
    const main = find(doc, (n) => n.attrs?.id === 'main-content') || find(doc, (n) => n.tag === 'body') || doc;
    const wanted = new Set();
    for (const n of findAll(main, (x) => x.tag === 'img' || x.tag === 'a')) {
      const k = fileFor(n.tag === 'img' ? n.attrs['data-image-src'] || n.attrs.src : n.attrs.href, base, lookup);
      if (k && !isPage.has(k) && k !== indexKey) wanted.add(k);
    }
    const section = find(doc, (n) => n.attrs?.id === 'attachments');
    const listed = section ? findAll(section.parent?.parent || section.parent, (n) => n.tag === 'a') : [];
    for (const a of listed) { const k = fileFor(a.attrs.href, base, lookup); if (k && !isPage.has(k)) wanted.add(k); }
    const urls = new Map();
    for (const k of wanted) { const u = await store.url(k); if (u) urls.set(k, u); }

    const used = new Set();
    const markdown = convert(main, {
      fromDir: base, lookup, used, report,
      pageId: (k) => (isPage.has(k) ? ids.get(k) : null),
      urlOf: (k) => urls.get(k) ?? null,
    });
    const parts = [markdown];
    // Files attached to the page but not shown in it — still the page's files.
    const rest = [...new Set(listed.map((a) => fileFor(a.attrs.href, base, lookup)))]
      .filter((k) => k && urls.has(k) && !used.has(k));
    if (rest.length) parts.push(`**Attachments**\n\n${rest.map((k) => `- [${esc(k.split('/').pop())}](${urls.get(k)})`).join('\n')}`);
    // The nesting is a reference in the parent's body, which is how the sidebar
    // and backlinks read it (see appendPageReference).
    for (const child of children.get(key) || []) parts.push(`[[${ids.get(child)}]]`);

    pages.push({
      id: ids.get(key), title: meta.get(key).title, folderId: rootId,
      parentId: parentOf.get(key) ? ids.get(parentOf.get(key)) : null,
      markdown: parts.filter(Boolean).join('\n\n'),
    });
  }
  return { folders: [{ id: rootId, name: (spaceName || rootName).slice(0, 200), parentId: null }], pages };
}
