// SPIKE: a BlockSuite page (its Yjs doc) as Tiptap/ProseMirror JSON.
//
// Plain JS with only `yjs` so the same file runs in the browser and, for the
// loss census, inside the server container on prod (read-only). Everything
// that has no Tiptap equivalent yet is counted in `lost` by kind, and kept as
// a visible placeholder paragraph rather than dropped silently.
import * as Y from 'yjs';

const MARKS = {
  bold: () => ({ type: 'bold' }),
  italic: () => ({ type: 'italic' }),
  strike: () => ({ type: 'strike' }),
  underline: () => ({ type: 'underline' }),
  code: () => ({ type: 'code' }),
  link: (v) => ({ type: 'link', attrs: { href: String(v) } }),
  color: (v) => ({ type: 'textStyle', attrs: { color: String(v) } }),
  background: (v) => ({ type: 'highlight', attrs: { color: String(v) } }),
  // A link to another page; Tiptap has no page-mention node out of the box.
  reference: (v) => ({ type: 'link', attrs: { href: `/d/${v?.pageId ?? ''}` } }),
};

export function convertDoc(ydoc) {
  const blocks = ydoc.getMap('blocks');
  const lost = {};
  const kept = {};
  const note = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
  const get = (id) => blocks.get(id);
  const kids = (b) => (b?.get('sys:children')?.toArray?.() ?? []).map(get).filter(Boolean);

  const inline = (ytext) => {
    if (!(ytext instanceof Y.Text)) return [];
    const out = [];
    for (const op of ytext.toDelta()) {
      if (typeof op.insert !== 'string' || !op.insert) continue;
      const marks = [];
      for (const [k, v] of Object.entries(op.attributes ?? {})) {
        if (v == null || v === false) continue;
        if (MARKS[k]) marks.push(MARKS[k](v));
        else note(lost, k.startsWith('comment-') ? 'mark:comment' : `mark:${k}`);
      }
      // ProseMirror keeps a mark type once per text node.
      const uniq = [...new Map(marks.map((m) => [m.type, m])).values()];
      out.push(uniq.length ? { type: 'text', text: op.insert, marks: uniq } : { type: 'text', text: op.insert });
    }
    return out;
  };
  const para = (content) => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' });
  const placeholder = (what) => { note(lost, what); return para([{ type: 'text', text: `[${what} — not converted]` }]); };

  const block = (b) => {
    const f = b.get('sys:flavour');
    const type = b.get('prop:type');
    const text = inline(b.get('prop:text'));
    switch (f) {
      case 'affine:paragraph': {
        note(kept, f);
        const h = /^h([1-6])$/.exec(type ?? '');
        const own = h ? { type: 'heading', attrs: { level: +h[1] }, ...(text.length ? { content: text } : {}) }
          : type === 'quote' ? { type: 'blockquote', content: [para(text)] }
            : para(text);
        // A paragraph's children (indented under it) follow it, flattened.
        return [own, ...many(kids(b))];
      }
      case 'affine:list':
        note(kept, f);
        return null; // grouped by `many`
      case 'affine:divider': note(kept, f); return [{ type: 'horizontalRule' }];
      case 'affine:code': {
        note(kept, f);
        const t = b.get('prop:text');
        const s = t instanceof Y.Text ? t.toString() : '';
        return [{ type: 'codeBlock', attrs: { language: b.get('prop:language') ?? null }, ...(s ? { content: [{ type: 'text', text: s }] } : {}) }];
      }
      case 'affine:image': {
        note(kept, f);
        const src = `/api/blob/${encodeURIComponent(b.get('prop:sourceId') ?? '')}`;
        return [{ type: 'image', attrs: { src, alt: b.get('prop:caption') ?? null } }];
      }
      case 'affine:table': return [table(b)];
      case 'affine:callout': {
        // Kept as a quote; the panel colour and emoji are lost.
        note(lost, 'style:callout');
        const inner = many(kids(b));
        return [{ type: 'blockquote', content: inner.length ? inner : [para(text)] }];
      }
      case 'affine:note': return many(kids(b));
      case 'metanoia:columns': case 'metanoia:column':
        // Side-by-side layout: the text is kept, stacked; the layout is lost.
        note(lost, 'layout:columns');
        return many(kids(b));
      default: {
        // Cards (bookmark, embeds, attachments) keep their link, lose the card.
        const url = b.get('prop:url');
        if (typeof url === 'string' && url) {
          note(lost, `card:${f}`);
          return [para([{ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }])];
        }
        return [placeholder(f)];
      }
    }
  };

  const table = (b) => {
    const order = (prefix, idKey) => {
      const m = new Map();
      for (const k of b.keys()) {
        const r = new RegExp(`^prop:${prefix}\\.([^.]+)\\.order$`).exec(k);
        if (r) m.set(r[1], b.get(k));
      }
      return [...m.entries()].sort((x, y) => String(x[1]).localeCompare(String(y[1]))).map(([id]) => id);
    };
    const rows = order('rows');
    const cols = order('columns');
    if (!rows.length || !cols.length) return placeholder('affine:table(empty)');
    note(kept, 'affine:table');
    return {
      type: 'table',
      content: rows.map((r, ri) => ({
        type: 'tableRow',
        content: cols.map((c) => ({
          type: ri === 0 ? 'tableHeader' : 'tableCell',
          content: [para(inline(b.get(`prop:cells.${r}:${c}.text`)))],
        })),
      })),
    };
  };

  const listItem = (b) => {
    const t = b.get('prop:type');
    const body = [para(inline(b.get('prop:text'))), ...many(kids(b))];
    return t === 'todo'
      ? { type: 'taskItem', attrs: { checked: !!b.get('prop:checked') }, content: body }
      : { type: 'listItem', content: body };
  };
  const LIST = { bulleted: 'bulletList', numbered: 'orderedList', todo: 'taskList', toggle: 'bulletList' };

  // Runs of list blocks of one kind become one list.
  function many(list) {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.get('sys:flavour') === 'affine:list') {
        const kind = LIST[b.get('prop:type')] ?? 'bulletList';
        const items = [];
        let j = i;
        while (j < list.length && list[j].get('sys:flavour') === 'affine:list' && (LIST[list[j].get('prop:type')] ?? 'bulletList') === kind) {
          note(kept, 'affine:list');
          items.push(listItem(list[j]));
          j++;
        }
        out.push({ type: kind, content: items });
        i = j - 1;
      } else {
        out.push(...(block(b) ?? []));
      }
    }
    return out;
  }

  let page = null;
  const surfaces = [];
  for (const [, b] of blocks) {
    const f = b.get('sys:flavour');
    if (f === 'affine:page') page = b;
    if (f === 'affine:surface') surfaces.push(b);
  }
  const title = page?.get('prop:title')?.toString?.() ?? '';
  // Canvas drawing (shapes, connectors, frames) has no Tiptap equivalent.
  for (const s of surfaces) {
    const els = s.get('prop:elements');
    const n = els?.get?.('value')?.size ?? els?.value?.size ?? 0;
    if (n) lost['canvas:elements'] = (lost['canvas:elements'] ?? 0) + n;
  }
  const notes = page ? kids(page).filter((b) => b.get('sys:flavour') === 'affine:note') : [];
  // Notes hidden from the page (canvas-only) are not part of the document.
  const visible = notes.filter((n) => n.get('prop:displayMode') !== 'edgeless');
  if (visible.length < notes.length) lost['canvas:edgeless-only-note'] = notes.length - visible.length;
  for (const b of page ? kids(page) : []) {
    const f = b.get('sys:flavour');
    if (f !== 'affine:note' && f !== 'affine:surface') note(lost, f);
  }
  const content = many(visible);
  return { title, doc: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }, kept, lost };
}
