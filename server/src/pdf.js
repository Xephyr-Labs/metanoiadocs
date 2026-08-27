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

const BULLETS = /^[•‣●○▪◦·–—-]\s+/;
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
 * Collect one page's glyph runs into lines carrying their baseline and size.
 * pdfjs gives each item a transform matrix; [5] is the baseline's y and [3] the
 * vertical scale, which for ordinary text is the font size.
 */
function pageLines(items) {
  const lines = [];
  for (const item of items) {
    const text = item.str;
    if (!text) continue;
    const y = item.transform[5];
    const size = Math.abs(item.transform[3]) || item.height || 0;
    const x = item.transform[4];
    const line = lines.find((l) => Math.abs(l.y - y) <= LINE_TOLERANCE);
    if (line) {
      line.parts.push({ x, text });
      line.size = Math.max(line.size, size);
    } else {
      lines.push({ y, size, parts: [{ x, text }] });
    }
  }

  // Top of the page downwards, and left to right within a line. pdfjs emits in
  // drawing order, which for multi-column and tagged PDFs is not reading order.
  lines.sort((a, b) => b.y - a.y);
  return lines.map((l) => {
    l.parts.sort((a, b) => a.x - b.x);
    // pdfjs splits a line wherever the text matrix changes — at a font switch,
    // a kern, a ligature. Joining without a separator would run words together;
    // joining with a space would break them apart. Insert one only where the
    // pieces already read as separate words.
    let text = '';
    for (const part of l.parts) {
      const needsSpace = text && !/\s$/.test(text) && !/^\s/.test(part.text);
      text += needsSpace ? ` ${part.text}` : part.text;
    }
    return { y: l.y, size: bucket(l.size), text: text.replace(/\s+/g, ' ').trim() };
  }).filter((l) => l.text);
}

/** The size most of the document is set in. */
function bodySize(lines) {
  const weight = new Map();
  for (const l of lines) weight.set(l.size, (weight.get(l.size) ?? 0) + l.text.length);
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
    const pages = [];
    let images = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(pageLines(content.items));
      // Counting images so the import can say what it left behind rather than
      // quietly dropping the figures.
      try {
        const ops = await page.getOperatorList();
        const paintImage = pdfjs.OPS?.paintImageXObject;
        if (paintImage !== undefined) {
          images += ops.fnArray.filter((fn) => fn === paintImage).length;
        }
      } catch {
        // An operator list that will not build costs us the image count only.
      }
      page.cleanup();
    }

    const all = pages.flat();
    if (!all.length) {
      throw new Error(
        'No text found in this PDF. It is probably a scan or images of pages, ' +
        'which needs OCR rather than import.',
      );
    }

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
      out.push(text, '');
      para = [];
    };

    for (const lines of pages) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const level = headingSizes.indexOf(line.size);
        if (level >= 0) {
          flush();
          out.push(`${'#'.repeat(level + 1)} ${line.text}`, '');
          continue;
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
          line.y - next.y < line.size * PARAGRAPH_GAP &&
          headingSizes.indexOf(next.size) < 0 &&
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
