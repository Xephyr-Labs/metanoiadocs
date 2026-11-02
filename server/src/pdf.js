// PDF import — text out of a PDF and into markdown.
//
// pdfjs-dist does the extraction. Hand-rolling it was the alternative and it is
// a trap: the bytes are the easy half, and the half that decides whether a
// document reads correctly is font encodings — CID fonts, embedded CMaps,
// ligature mappings, the difference between a glyph index and a character.
// Mozilla maintains that table; we would be maintaining a worse one.
//
// Structure, though, is ours to guess. A PDF has no headings and no paragraphs,
// only glyphs at coordinates, so everything below is reconstruction: group runs
// into lines by baseline, lines into paragraphs by vertical gap, and call a line
// a heading when its type is meaningfully larger than the body.

/** Same baseline within this many points is the same line. */
const LINE_TOLERANCE = 2.5;

/** A gap wider than this many times the line height starts a new paragraph. */
const PARAGRAPH_GAP = 1.6;

/** Type this much larger than the body is a heading rather than emphasis. */
const HEADING_RATIO = 1.15;

/** A gap between runs wider than this many times the font size separates table cells, not words. */
const CELL_GAP = 1.5;

/** A gap wider than this many times the font size is a space between words. */
const WORD_GAP = 0.15;

// Word and LibreOffice draw bullets in Symbol/Wingdings, whose glyphs extract
// as private-use code points (U+F0B7 is Symbol's bullet, U+F0A7 Wingdings').
const BULLETS = /^[•‣●○▪◦·–—\-]\s+/;
const ORDERED = /^(\d{1,3})[.)]\s+/;

/**
 * pdfjs is loaded on first use rather than at import.
 *
 * It is the only heavyweight dependency in this server and nothing else needs
 * it, so a deployment that never imports a PDF never pays for it — and, more to
 * the point, a missing or broken install fails one endpoint with a clear
 * message instead of stopping the server from booting.
 */
let pdfjsPromise = null;
function loadPdfjs() {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs').catch(() => {
    throw new Error('PDF support is unavailable on this server (pdfjs-dist is not installed).');
  });
  return pdfjsPromise;
}

/** Round a font size so 11.999 and 12.001 are the same heading level. */
const bucket = (n) => Math.round(n * 2) / 2;

/**
 * Markdown for a run of parts that share one style. Markers go inside any
 * surrounding whitespace: `** bold**` is not bold in markdown.
 */
function styled(seg) {
  const [, lead, core, trail] = /^(\s*)(.*?)(\s*)$/s.exec(seg.text);
  if (!core) return seg.text;
  let t = core;
  if (seg.italic) t = `*${t}*`;
  if (seg.bold) t = `**${t}**`;
  if (seg.href) t = `[${t}](${seg.href})`;
  return lead + t + trail;
}

/** Join one cell's parts into markdown and plain text. */
function renderCell(parts) {
  const segs = [];
  let prev = null;
  for (const part of parts) {
    const seg = segs.at(-1);
    // Whitespace has no style worth keeping; it rides along with whatever run
    // it sits in rather than splitting `**a b**` into two bold runs.
    if (!part.text.trim()) {
      if (seg) seg.text += part.text;
      continue;
    }
    // pdfjs splits a line wherever the text matrix changes — at a font switch,
    // a kern, a ligature. Joining without a separator would run words together;
    // joining with a space would break them apart. Where the run widths are
    // known, the gap between them decides; otherwise insert one only where the
    // pieces do not already read as separate words.
    const text = seg ? seg.text : '';
    const gap = prev && prev.end > prev.x ? part.x - prev.end > part.size * WORD_GAP : true;
    const space = prev && gap && !/\s$/.test(text) && !/^\s/.test(part.text) ? ' ' : '';
    if (seg && seg.bold === part.bold && seg.italic === part.italic && seg.href === part.href) {
      seg.text += space + part.text;
    } else {
      if (seg) seg.text += space;
      segs.push({ text: part.text, bold: part.bold, italic: part.italic, href: part.href });
    }
    prev = part;
  }
  const tidy = (s) => s.replace(/\s+/g, ' ').trim();
  return { text: tidy(segs.map(styled).join('')), plain: tidy(segs.map((s) => s.text).join('')) };
}

/**
 * Collect one page's glyph runs into lines carrying their baseline and size.
 * pdfjs gives each item a transform matrix; [5] is the baseline's y and [3] the
 * vertical scale, which for ordinary text is the font size.
 *
 * @param fontStyle maps a pdfjs font id to {bold, italic}
 * @param links the page's link annotations, as {rect, url}
 */
function pageLines(items, fontStyle = () => ({}), links = []) {
  const lines = [];
  for (const item of items) {
    const text = item.str;
    if (!text) continue;
    const y = item.transform[5];
    const size = Math.abs(item.transform[3]) || item.height || 0;
    const x = item.transform[4];
    const mid = x + (item.width || 0) / 2;
    const href = links.find(({ rect: [x1, y1, x2, y2] }) => mid >= x1 && mid <= x2 && y >= y1 - 1 && y <= y2 + 1)?.url;
    const part = { x, end: x + (item.width || 0), size, text, href, ...fontStyle(item.fontName) };
    const line = lines.find((l) => Math.abs(l.y - y) <= LINE_TOLERANCE);
    if (line) {
      line.parts.push(part);
      line.size = Math.max(line.size, size);
    } else {
      lines.push({ y, size, parts: [part] });
    }
  }

  // Top of the page downwards, and left to right within a line. pdfjs emits in
  // drawing order, which for multi-column and tagged PDFs is not reading order.
  lines.sort((a, b) => b.y - a.y);
  const result = lines.map((l) => {
    l.parts.sort((a, b) => a.x - b.x);
    // A gap far wider than a word space is a column boundary: a table, or
    // label/value pairs set on tab stops. Split there so a run of such lines
    // can be told apart from prose.
    const cells = [];
    let prev = null;
    for (const part of l.parts) {
      const blank = !part.text.trim();
      if (!cells.length || (!blank && prev && prev.end > prev.x && part.x - prev.end > l.size * CELL_GAP)) {
        if (blank) continue;
        cells.push({ x: part.x, parts: [] });
      }
      cells.at(-1).parts.push(part);
      if (!blank) { prev = part; cells.at(-1).end = part.end; }
    }
    const rendered = cells.map((c) => ({ x: c.x, end: c.end, ...renderCell(c.parts) }));
    return {
      y: l.y,
      size: bucket(l.size),
      text: rendered.map((c) => c.text).join(' '),
      plain: rendered.map((c) => c.plain).join(' '),
      cells: rendered.length > 1 ? rendered : null,
    };
  }).filter((l) => l.plain);

  // Two columns of prose: sorted by baseline alone they interleave a line at a
  // time. The gutter is an x where several runs start and no run crosses; read
  // the left column top to bottom, then the right.
  // ponytail: a full-width title or abstract crossing the gutter disables the
  // split for the whole page; per-band column detection if that comes up.
  const runs = items.filter((it) => it.str.trim());
  const starts = new Map();
  for (const it of runs) {
    const x = Math.round(it.transform[4]);
    starts.set(x, (starts.get(x) ?? 0) + 1);
  }
  const minX = Math.min(...starts.keys());
  // A table's columns also start runs at a common x; prose is what has long runs.
  const prose = (side) => side.length >= 3 && side.filter((it) => it.str.trim().length >= 20).length * 2 >= side.length;
  for (const [g, count] of [...starts].sort((a, b) => a[0] - b[0])) {
    if (g <= minX + 2 || count < 3) continue;
    if (runs.some((it) => it.transform[4] < g - 2 && it.transform[4] + (it.width || 0) > g)) continue;
    const left = items.filter((it) => it.transform[4] < g - 2);
    const right = items.filter((it) => it.transform[4] >= g - 2);
    if (!prose(left.filter((it) => it.str.trim())) || !prose(right.filter((it) => it.str.trim()))) continue;
    return [...pageLines(left, fontStyle, links), ...pageLines(right, fontStyle, links)];
  }
  return result;
}

/**
 * Drop running heads, running feet and page numbers: lines at the top or
 * bottom of a page that recur at the same height on at least half the pages.
 * Digits are ignored in the comparison so "Page 3" matches "Page 4".
 */
function dropRunningLines(pages) {
  const key = (l) => `${Math.round(l.y)}|${l.plain.replace(/\d+/g, '#')}`;
  const edge = (lines, i) => i < 2 || i >= lines.length - 2;
  const seen = new Map();
  for (const lines of pages) {
    for (const k of new Set(lines.filter((l, i) => edge(lines, i)).map(key))) {
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
  }
  const min = Math.max(2, pages.length / 2);
  return pages.map((lines) => lines.filter((l, i) => !(edge(lines, i) && seen.get(key(l)) >= min)));
}

/**
 * Two cell rows are the same table when they have as many cells and each one
 * lines up, by its left edge or (for right-aligned numbers) its right.
 */
function sameTable(a, b) {
  if (!b?.cells || b.cells.length !== a.cells.length) return false;
  return b.cells.every((c, k) => {
    const h = a.cells[k];
    return Math.abs(c.x - h.x) < a.size * 2 || Math.abs(c.end - h.end) < a.size * 2;
  });
}

// ponytail: two-column prose also splits into aligned "cells"; short cells are
// the only thing telling a table from it. Tables with long cell text stay prose.
const MAX_CELL = 40;

/** The size most of the document is set in. */
function bodySize(lines) {
  const weight = new Map();
  for (const l of lines) weight.set(l.size, (weight.get(l.size) ?? 0) + l.plain.length);
  let best = 0;
  let bestWeight = -1;
  for (const [size, w] of weight) {
    if (w > bestWeight) { best = size; bestWeight = w; }
  }
  return best;
}

/**
 * Convert a PDF to markdown.
 *
 * @param {Buffer} buf the file
 * @returns {Promise<{markdown: string, warnings: string[]}>}
 * @throws if the file is encrypted, corrupt, or carries no text layer
 */
export async function pdfToMarkdown(buf) {
  const pdfjs = await loadPdfjs();
  const warnings = [];

  // Keep the loading task: cleanup lives on it, not on the document proxy.
  let task;
  let doc;
  try {
    task = pdfjs.getDocument({
      // pdfjs mutates the buffer it is handed, and `buf` may be a view onto a
      // larger request body.
      data: new Uint8Array(buf),
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      // Extraction only; nothing here renders a page.
      stopAtErrors: false,
    });
    doc = await task.promise;
  } catch (err) {
    await task?.destroy().catch(() => {});
    if (err?.name === 'PasswordException') {
      throw new Error('This PDF is password-protected.');
    }
    if (err?.name === 'InvalidPDFException') {
      throw new Error('This file is not a readable PDF.');
    }
    throw new Error(`This PDF could not be read: ${err?.message || 'unknown error'}`);
  }

  try {
    let pages = [];
    let images = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      // Counting images so the import can say what it left behind rather than
      // quietly dropping the figures. Building the operator list also loads the
      // page's fonts, which is where bold and italic come from.
      try {
        const ops = await page.getOperatorList();
        const paintImage = pdfjs.OPS?.paintImageXObject;
        if (paintImage !== undefined) {
          images += ops.fnArray.filter((fn) => fn === paintImage).length;
        }
      } catch {
        // An operator list that will not build costs us the image count only.
      }
      // Text items carry only a font id; weight and slant are in the font's
      // PostScript name ("ABCDEF+NotoSerif-BoldItalic").
      const fontStyle = (id) => {
        let name = '';
        try { name = page.commonObjs.get(id)?.name ?? ''; } catch { /* font never loaded */ }
        return { bold: /Bold|Black|Heavy/i.test(name), italic: /Italic|Oblique/i.test(name) };
      };
      const links = (await page.getAnnotations().catch(() => []))
        .filter((a) => a.subtype === 'Link' && /^(https?|mailto):/i.test(a.url ?? ''))
        .map((a) => ({ rect: a.rect, url: a.url }));
      pages.push(pageLines(content.items, fontStyle, links));
      page.cleanup();
    }

    if (!pages.some((lines) => lines.length)) {
      throw new Error(
        'No text found in this PDF. It is probably a scan or images of pages, ' +
        'which needs OCR rather than import.',
      );
    }
    pages = dropRunningLines(pages);
    const all = pages.flat();

    const body = bodySize(all);
    // Distinct heading sizes, largest first, become h1, h2, h3…
    const headingSizes = [...new Set(all.filter((l) => l.size > body * HEADING_RATIO).map((l) => l.size))]
      .sort((a, b) => b - a)
      .slice(0, 6);

    const out = [];
    // A paragraph is accumulated across the visual lines it wrapped over, then
    // flushed when something ends it: a gap, a heading, a list item, the page.
    let para = [];
    const flush = () => {
      if (!para.length) return;
      let text = para[0];
      for (const line of para.slice(1)) {
        // A word broken across a line break is joined back up; anything else
        // gets the space the line break stood for.
        text = /[\p{Ll}]-$/u.test(text) && /^[\p{Ll}]/u.test(line)
          ? text.slice(0, -1) + line
          : `${text} ${line}`;
      }
      // The blank line before matters after a list: without it markdown reads
      // the paragraph as a continuation of the last item.
      out.push('', text, '');
      para = [];
    };

    for (const lines of pages) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const level = headingSizes.indexOf(line.size);
        if (level >= 0) {
          flush();
          out.push('', `${'#'.repeat(level + 1)} ${line.plain}`, '');
          continue;
        }

        // Two or more consecutive rows whose cells line up are a table.
        if (line.cells && line.cells.every((c) => c.plain.length <= MAX_CELL)) {
          let j = i + 1;
          while (sameTable(line, lines[j]) && lines[j].cells.every((c) => c.plain.length <= MAX_CELL)) j++;
          if (j - i >= 2) {
            flush();
            const row = (l) => `| ${l.cells.map((c) => c.text.replace(/\|/g, '\\|')).join(' | ')} |`;
            out.push('', row(line), `|${' --- |'.repeat(line.cells.length)}`, ...lines.slice(i + 1, j).map(row), '');
            i = j - 1;
            continue;
          }
        }

        const bullet = BULLETS.exec(line.text);
        if (bullet) {
          flush();
          out.push(`- ${line.text.slice(bullet[0].length)}`);
          continue;
        }
        const ordered = ORDERED.exec(line.text);
        if (ordered) {
          flush();
          out.push(`${ordered[1]}. ${line.text.slice(ordered[0].length)}`);
          continue;
        }

        para.push(line.text);
        // Join wrapped lines back into one paragraph: a PDF breaks wherever the
        // column ran out, and importing each visual line as its own block makes
        // the document unusable in an editor that reflows.
        const next = lines[i + 1];
        const wraps =
          next &&
          // Below, not just near: the next column starts back at the top.
          line.y > next.y &&
          line.y - next.y < line.size * PARAGRAPH_GAP &&
          headingSizes.indexOf(next.size) < 0 &&
          !next.cells &&
          !BULLETS.test(next.text) &&
          !ORDERED.test(next.text);
        if (!wraps) flush();
      }
      flush();
    }

    if (images) {
      warnings.push(
        `${images} image${images === 1 ? '' : 's'} in this PDF ${images === 1 ? 'was' : 'were'} not imported.`,
      );
    }

    const markdown = out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
    return { markdown, warnings };
  } finally {
    await task.destroy().catch(() => {});
  }
}
