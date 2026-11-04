// Archive import — a whole space, vault or folder of notes in one zip.
//
// Same pipeline as a single file, one step wider: every page ends up as the
// markdown import.js already produces and goes through createDocRow, so
// buildDocState, search text and link storage are shared, not copied. What this
// file adds is the shape around the pages — folders, page nesting, attachments
// in the blob table, and links between pages rewritten to `[[page-id]]`, the
// form linkResolver already understands.
//
// Three sources, one route (`kind`):
//   confluence  Space export → HTML (confluence-import.js)
//   obsidian    a vault: [[wiki links]], ![[embeds]], front matter, callouts
//   markdown    any zip of .md files with relative links (Slab, GitHub wikis…)
//
// OneNote is not here: it only exports through Microsoft Graph.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { unzipSync } from './unzip.js';
import { stripFrontMatter, titleFromMarkdown } from './import.js';
import { planConfluence } from './confluence-import.js';
import { pageLinksOf } from './blocks.js';
import { spaceOf, spaceForNew } from './space-move.js';

export const ARCHIVE_KINDS = ['confluence', 'obsidian', 'markdown'];
/** The compressed upload. What it may inflate to is unzip.js's ZIP_LIMITS. */
export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|tiff?)$/i;
const MARKDOWN = /\.(md|markdown)$/i;

// ── archive hygiene ────────────────────────────────────────────────────────

/**
 * Drop what is not content: dot-folders (`.obsidian/`, `.trash/`, `.git/`), the
 * macOS resource-fork litter and Windows thumbnails. Backslash paths (zips
 * written on Windows) become `/`.
 */
export function cleanEntries(files) {
  const out = new Map();
  for (const [name, bytes] of files) {
    const key = name.replace(/\\/g, '/').replace(/^\.\//, '');
    const segs = key.split('/');
    if (segs.some((s) => s.startsWith('.') || s === '__MACOSX') || /^thumbs\.db$/i.test(segs[segs.length - 1])) continue;
    out.set(key, bytes);
  }
  return out;
}

/** A zip of a folder holds one top-level folder; its name is the import's name. */
function unwrapRoot(files, fallback) {
  const tops = new Set([...files.keys()].map((k) => k.split('/')[0]));
  if (tops.size !== 1 || ![...files.keys()].every((k) => k.includes('/'))) return { files, rootName: fallback };
  const [top] = tops;
  return { files: new Map([...files].map(([k, v]) => [k.slice(top.length + 1), v])), rootName: top };
}

/**
 * Attachments saved on demand, once each, keyed by archive path. Only files a
 * page actually points at are stored: a vault's unused downloads stay behind.
 */
export function attachmentStore(files, saveFile) {
  const cache = new Map();
  return {
    async url(key) {
      if (!files.has(key)) return null;
      if (!cache.has(key)) {
        const name = key.split('/').pop();
        const saved = await saveFile(files.get(key), name);
        // A picture is shown by its blob; any other file downloads under its own name.
        cache.set(key, saved && (IMAGE.test(name) ? saved : `${saved}?name=${encodeURIComponent(name)}`));
      }
      return cache.get(key);
    },
    get count() { return [...cache.values()].filter(Boolean).length; },
  };
}

async function replaceAsync(str, re, fn) {
  const parts = [];
  let last = 0;
  for (const m of str.matchAll(re)) {
    parts.push(str.slice(last, m.index), await fn(...m));
    last = m.index + m[0].length;
  }
  parts.push(str.slice(last));
  return parts.join('');
}

/** Run `fn` over prose only: fenced code and `inline code` mean what they say. */
async function mapProse(md, fn) {
  const out = [];
  let fenced = false;
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; out.push(line); continue; }
    if (fenced) { out.push(line); continue; }
    const parts = line.split(/(`[^`]*`)/);
    for (let i = 0; i < parts.length; i += 2) parts[i] = await fn(parts[i]);
    out.push(parts.join(''));
  }
  return out.join('\n');
}

// ── markdown folders (Obsidian and generic) ────────────────────────────────

const OBSIDIAN_CALLOUTS = new Set(['info', 'note', 'success', 'warning', 'error', 'tip', 'important', 'caution', 'danger']);

/** Obsidian-only syntax that has an equivalent here; the rest is left as written. */
function obsidianProse(line) {
  return line
    .replace(/%%[^%]*%%/g, '')
    .replace(/==([^=\n]+)==/g, '<mark>$1</mark>')
    .replace(/\s\^[A-Za-z0-9-]+$/, '')
    // Callouts: "> [!question]- Title" → a panel. Types we have no panel for become notes.
    .replace(/^(\s*>\s*)\[!(\w+)\][+-]?/, (_, lead, type) => `${lead}[!${OBSIDIAN_CALLOUTS.has(type.toLowerCase()) ? type : 'NOTE'}]`);
}

async function planMarkdown(kind, files, { store, newId, report, rootName }) {
  const keys = [...files.keys()].filter((k) => MARKDOWN.test(k)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!keys.length) throw new Error('There are no Markdown (.md) files in that zip.');

  const rootId = newId();
  const folders = [{ id: rootId, name: rootName.slice(0, 200), parentId: null }];
  const folderIds = new Map([['', rootId]]);
  const folderFor = (dir) => {
    if (folderIds.has(dir)) return folderIds.get(dir);
    const cut = dir.lastIndexOf('/');
    const id = newId();
    folders.push({ id, name: dir.slice(cut + 1).slice(0, 200), parentId: folderFor(cut < 0 ? '' : dir.slice(0, cut)) });
    folderIds.set(dir, id);
    return id;
  };

  const pageIds = new Map(keys.map((k) => [k, newId()]));
  const lowerPaths = new Map([...files.keys()].map((k) => [k.toLowerCase(), k]));
  const byBase = new Map();
  for (const k of files.keys()) {
    const b = k.slice(k.lastIndexOf('/') + 1).toLowerCase();
    byBase.set(b, [...(byBase.get(b) || []), k]);
  }
  const dirOf = (k) => k.slice(0, k.lastIndexOf('/') + 1);

  /**
   * Obsidian's rule for a bare name: any file whose path ends with it
   * ("Note" matches "a/b/Note.md"); the one beside the linking page wins, then
   * the shortest path, so a name that is unique resolves and one that is not
   * still resolves the way the app would.
   */
  function find(target, fromKey) {
    const t = target.trim().replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
    if (!t) return null;
    const hits = new Set();
    for (const cand of [t, `${t}.md`]) {
      for (const k of byBase.get(cand.slice(cand.lastIndexOf('/') + 1)) || []) {
        const lk = k.toLowerCase();
        if (lk === cand || lk.endsWith(`/${cand}`)) hits.add(k);
      }
    }
    return [...hits].sort((a, b) => {
      const near = (k) => (dirOf(k) === dirOf(fromKey) ? 0 : 1);
      return near(a) - near(b) || a.split('/').length - b.split('/').length || a.localeCompare(b);
    })[0] ?? null;
  }

  /** `[text](rel/path.md#h)`: relative to the page, else by name as a last resort. */
  function findRelative(href, fromKey) {
    let rel = href.split('#')[0].split('?')[0];
    try { rel = decodeURIComponent(rel); } catch { /* as written */ }
    const parts = [];
    for (const seg of ((rel.startsWith('/') ? '' : dirOf(fromKey)) + rel).split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') parts.pop(); else parts.push(seg);
    }
    return lowerPaths.get(parts.join('/').toLowerCase()) ?? find(rel, fromKey);
  }

  const LINK = /(!?)\[\[([^\]\n]+)\]\]|(!?)\[([^\]\n]*)\]\((<[^>\n]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g;

  async function rewrite(prose, fromKey) {
    return replaceAsync(prose, LINK, async (whole, wBang, wInner, mBang, mText, mTarget) => {
      let hit;
      let embed;
      let label;
      if (wInner !== undefined) {
        embed = !!wBang;
        const [target, opt = ''] = wInner.split('|');
        const page = target.split('#')[0].split('^')[0];
        if (!page.trim()) return whole; // [[#Heading]]: a link within this page
        hit = find(page, fromKey);
        label = /^\d+(x\d+)?$/.test(opt.trim()) ? '' : opt.trim();
        if (!hit) { report.unresolved.push(page.trim()); return whole; }
      } else {
        embed = !!mBang;
        const href = mTarget.replace(/^<|>$/g, '');
        if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('//')) return whole;
        hit = findRelative(href, fromKey);
        label = mText;
        if (!hit) { report.unresolved.push(href.split('#')[0]); return whole; }
      }
      if (pageIds.has(hit)) return `[[${pageIds.get(hit)}]]`;
      const url = await store.url(hit);
      if (!url) return whole;
      const name = hit.split('/').pop();
      // An image block has to be alone on its line; the newlines make it so.
      return embed && IMAGE.test(name) ? `\n![${label.replace(/[\]\n]/g, ' ')}](${url})\n` : `[${label || name}](${url})`;
    });
  }

  const pages = [];
  for (const key of keys) {
    const raw = files.get(key).toString('utf8').replace(/\r\n?/g, '\n');
    const body = stripFrontMatter(raw);
    let md = await mapProse(body, async (p) => rewrite(kind === 'obsidian' ? obsidianProse(p) : p, key));
    const base = key.slice(key.lastIndexOf('/') + 1).replace(MARKDOWN, '');
    if (kind === 'obsidian') {
      // Page properties are workspace-wide typed definitions; an import must not
      // mint those on its own, so the YAML stays readable at the top instead.
      const fm = raw.replace(/^﻿/, '').slice(0, raw.replace(/^﻿/, '').length - body.length)
        .replace(/^---[ \t]*\n/, '').replace(/\n---[ \t]*\n*$/, '').trim();
      if (fm) md = `\`\`\`yaml\n${fm}\n\`\`\`\n\n${md}`;
    }
    const cut = key.lastIndexOf('/');
    pages.push({
      id: pageIds.get(key),
      // Obsidian names a note by its file; elsewhere the first heading is the title.
      title: kind === 'obsidian' ? base.slice(0, 200) : titleFromMarkdown(md, base),
      folderId: folderFor(cut < 0 ? '' : key.slice(0, cut)),
      parentId: null,
      markdown: md,
    });
  }
  return { folders, pages };
}

// ── plan ───────────────────────────────────────────────────────────────────

/**
 * Turn an unzipped archive into what to create.
 *
 * @returns {Promise<{folders: {id,name,parentId}[], pages: {id,title,folderId,parentId,markdown}[],
 *   summary: {pages, folders, attachments, unresolvedLinks, unresolved, unknownMacros}}>}
 */
export async function planArchive(kind, rawFiles, { saveFile, rootName = 'Import', newId = () => crypto.randomUUID() }) {
  if (!ARCHIVE_KINDS.includes(kind)) throw new Error(`Unknown import source "${kind}".`);
  let files = cleanEntries(rawFiles);
  let name = rootName;
  if (kind !== 'confluence') ({ files, rootName: name } = unwrapRoot(files, rootName));
  const store = attachmentStore(files, saveFile);
  const report = { unresolved: [], macros: {} };
  const deps = { store, newId, report, rootName: name };
  const plan = kind === 'confluence' ? await planConfluence(files, deps) : await planMarkdown(kind, files, deps);
  if (!plan.pages.length) throw new Error('That archive has no pages in it.');
  const unresolved = [...new Set(report.unresolved)];
  return {
    ...plan,
    summary: {
      pages: plan.pages.length, folders: plan.folders.length, attachments: store.count,
      unresolvedLinks: report.unresolved.length, unresolved: unresolved.slice(0, 20), unknownMacros: report.macros,
    },
  };
}

/** The summary as lines for the person who ran the import. */
export function summaryLines(s) {
  const n = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const lines = [`Imported ${n(s.pages, 'page')}, ${n(s.folders, 'folder')}, ${n(s.attachments, 'attachment')}.`];
  if (s.unresolvedLinks) {
    lines.push(`${n(s.unresolvedLinks, 'link')} could not be resolved and ${s.unresolvedLinks === 1 ? 'was' : 'were'} left as written: ${s.unresolved.join(', ')}${s.unresolvedLinks > s.unresolved.length ? ', …' : ''}.`);
  }
  const macros = Object.entries(s.unknownMacros);
  if (macros.length) {
    lines.push(`Confluence macros with no equivalent here, kept as plain text: ${macros.map(([k, v]) => `${k} ×${v}`).join(', ')}.`);
  }
  return lines;
}

// ── route ──────────────────────────────────────────────────────────────────

export function registerArchiveRoutes(app, { requireUser, wrap, createDocRow, storeLinks, saveBlob, visibleFolder, raw }) {
  /**
   * Import a zip as a tree of pages. Raw bytes like every other import here;
   * the source, destination and zip name ride on the query string.
   *
   * It writes only what the person could create by hand — pages and folders
   * they own, in a folder they can see — so no new access rule is involved. If
   * anything fails part-way the rows made so far are removed again: a half
   * imported space is harder to clean up than none.
   */
  app.post('/api/docs/import-archive', requireUser, raw, wrap(async (req, res) => {
    const kind = String(req.query.kind || '');
    if (!ARCHIVE_KINDS.includes(kind)) return res.status(400).json({ error: `kind must be one of ${ARCHIVE_KINDS.join(', ')}` });
    const name = String(req.query.name || 'Import').slice(0, 255);
    const folderId = typeof req.query.folderId === 'string' && req.query.folderId ? req.query.folderId : null;
    if (folderId && !(await visibleFolder(folderId, req.user.id))) return res.status(403).json({ error: 'folder not accessible' });

    let plan;
    try {
      const files = unzipSync(req.body);
      plan = await planArchive(kind, files, { saveFile: saveBlob, rootName: name.replace(/\.zip$/i, '') || 'Import' });
    } catch (e) {
      // 415 like the single-file import: the request was fine, the file was not.
      return res.status(415).json({ error: e.message });
    }

    const spaceId = await spaceForNew(pool, { folderSpace: await spaceOf(pool, 'folder', folderId), requested: req.query.spaceId });
    const folderIds = [];
    const pageIds = [];
    try {
      for (const f of plan.folders) {
        await pool.query(
          `INSERT INTO folders (id, name, parent_id, position, created_by, space_id)
           VALUES ($1, $2, $3, COALESCE((SELECT max(position) + 1 FROM folders WHERE parent_id IS NOT DISTINCT FROM $3 AND deleted_at IS NULL), 0), $4, $5)`,
          [f.id, f.name, f.parentId ?? folderId, req.user.id, spaceId],
        );
        folderIds.push(f.id);
      }
      const planned = new Set(plan.pages.map((p) => p.id));
      // Only the pages of this import are link targets: the single-file import's
      // title lookup would tie an imported "Roadmap" to whichever page already had that name.
      const links = { resolve: (key) => { const id = String(key).split('|')[0].trim(); return planned.has(id) ? id : null; } };
      for (const p of plan.pages) {
        await createDocRow({
          id: p.id, title: p.title, icon: '📄', userId: req.user.id, folderId: p.folderId, spaceId,
          visibility: 'team', kind: 'doc', content: p.markdown, links,
        });
        pageIds.push(p.id);
      }
      // Targets did not exist yet when each page was written, so their link rows
      // and nesting are recorded now that all of them do.
      for (const p of plan.pages) {
        if (p.parentId) await pool.query('UPDATE docs SET parent_id = $2 WHERE id = $1', [p.id, p.parentId]);
        const { rows } = await pool.query('SELECT state FROM doc_states WHERE doc_id = $1', [p.id]);
        if (rows[0]) await storeLinks(p.id, pageLinksOf(rows[0].state));
      }
    } catch (e) {
      await pool.query('DELETE FROM docs WHERE id = ANY($1)', [pageIds]).catch(() => {});
      await pool.query('DELETE FROM folders WHERE id = ANY($1)', [folderIds]).catch(() => {});
      throw e;
    }
    res.json({ id: plan.pages[0].id, folderId: plan.folders[0].id, summary: plan.summary, warnings: summaryLines(plan.summary) });
  }));
}
