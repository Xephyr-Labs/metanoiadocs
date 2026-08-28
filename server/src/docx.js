// Word (.docx) export.
//
// Same pipeline as the PDF export: the stored Yjs state becomes markdown, and
// parseMarkdown turns that back into block descriptors. This module renders
// those descriptors as WordprocessingML instead of HTML, so both exports agree
// about what a document contains and only differ in how they draw it.
//
// A .docx is a ZIP of XML parts; see zip.js for the container. Everything here
// is the OOXML: one document part, a stylesheet, a numbering definition, the
// relationship files that tie them together, and the images.
import { parseMarkdown, imageDescAsParagraph } from './blocks.js';
import { zipSync, imageSize } from './zip.js';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Word measures in twentieths of a point, and pictures in EMU (914400 per inch).
const EMU_PER_PX = 9525; // at 96dpi, the unit a browser laid the image out in
const MAX_IMAGE_EMU = 6 * 914400; // the text column of a US Letter page at 1" margins

const NUM_BULLET = 1; // w:numId for every bulleted/todo list
const NUM_ORDERED_BASE = 2; // ordered lists take 2, 3, 4… so each restarts at 1

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

/** Only http(s) and same-origin paths survive into a hyperlink. */
const safeUrl = (u) => {
  const s = String(u ?? '').trim();
  return /^(https?:\/\/|\/)/i.test(s) ? s : '';
};

/**
 * Markdown inline syntax → a flat list of runs.
 *
 * Code spans come out first and go back last, the same trick print.js uses, so
 * a `**` inside backticks stays literal instead of turning bold.
 */
export function inlineRuns(src) {
  const code = [];
  const text = String(src ?? '').replace(/`([^`]+)`/g, (_, c) => {
    code.push(c);
    return `\x00${code.length - 1}\x00`;
  });

  const runs = [];
  // One pass, alternating between "plain text" and whichever marker comes next.
  // Order matters: images before links (they differ by one leading `!`) and the
  // two-character markers before the one-character one.
  const TOKEN =
    /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*\n]+)\*|\[\[([^\]]+)\]\]|\x00(\d+)\x00/g;

  let last = 0;
  let m;
  while ((m = TOKEN.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    if (m[2] !== undefined) runs.push({ image: safeUrl(m[2]), alt: m[1] });
    else if (m[4] !== undefined) runs.push({ text: m[3], link: safeUrl(m[4]) });
    else if (m[5] !== undefined) runs.push({ text: m[5], bold: true });
    else if (m[6] !== undefined) runs.push({ text: m[6], strike: true });
    else if (m[7] !== undefined) runs.push({ text: m[7], italic: true });
    else if (m[8] !== undefined) runs.push({ text: m[8], reference: true });
    else runs.push({ text: code[Number(m[9])], code: true });
    last = TOKEN.lastIndex;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  // A run left holding a code placeholder (unbalanced backticks) would print the
  // NUL bytes, so strip any that escaped the pass above.
  return runs
    .map((r) => (r.text === undefined ? r : { ...r, text: r.text.replace(/\x00(\d+)\x00/g, (_, i) => code[Number(i)] ?? '') }))
    .filter((r) => r.image !== undefined || r.text !== '');
}

function runXml(run, rels) {
  if (run.image !== undefined) return imageXml(run, rels);

  const props = [];
  if (run.bold) props.push('<w:b/>');
  if (run.italic) props.push('<w:i/>');
  if (run.strike) props.push('<w:strike/>');
  if (run.code) props.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:val="clear" w:fill="F4F4F6"/>');
  if (run.link || run.reference) props.push('<w:color w:val="1B64DA"/>');
  if (run.link) props.push('<w:u w:val="single"/>');
  const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
  // xml:space="preserve" or Word eats the spaces between runs, and every
  // bold word ends up glued to the one after it.
  const body = `<w:r>${rPr}<w:t xml:space="preserve">${esc(run.text)}</w:t></w:r>`;

  if (!run.link) return body;
  const id = rels.external(run.link);
  return `<w:hyperlink r:id="${id}">${body}</w:hyperlink>`;
}

function imageXml(run, rels) {
  const img = rels.image(run.image);
  if (!img) return run.alt ? runXml({ text: run.alt, italic: true }, rels) : '';
  const { id, cx, cy, index } = img;
  return (
    `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${index}" name="Picture ${index}" descr="${esc(run.alt || '')}"/>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="${index}" name="Picture ${index}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  );
}

const para = (style, runs, extra = '') =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>${runs}</w:p>`;

function listPr(numId, level) {
  return `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr>`;
}

function tableXml(rows, rels) {
  const [head, ...body] = rows;
  const cols = head.length;
  const width = Math.floor(9360 / Math.max(cols, 1)); // twips across the text column
  const cell = (text, isHead) =>
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>` +
    (isHead ? '<w:shd w:val="clear" w:fill="F7F7F9"/>' : '') +
    `</w:tcPr>${para(null, inlineRuns(text).map((r) => runXml(isHead ? { ...r, bold: true } : r, rels)).join('') || '<w:r><w:t/></w:r>')}</w:tc>`;

  const borders =
    '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="E4E4E8"/>`)
      .join('') +
    '</w:tblBorders>';

  const tr = (cells, isHead) =>
    `<w:tr>${isHead ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells
      .concat(Array(Math.max(0, cols - cells.length)).fill(''))
      .slice(0, cols)
      .map((c) => cell(c, isHead))
      .join('')}</w:tr>`;

  return (
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${borders}</w:tblPr>` +
    tr(head, true) +
    body.map((r) => tr(r, false)).join('') +
    '</w:tbl>'
  );
}

/** Block descriptors → the body of word/document.xml. */
function bodyXml(descs, rels) {
  const out = [];
  // Each ordered list gets its own w:numId so it starts at 1 rather than
  // continuing the previous list's count.
  let orderedId = NUM_ORDERED_BASE - 1;
  let inOrdered = false;

  for (const d of descs) {
    const ordered = d.flavour === 'affine:list' && d.type === 'numbered';
    if (ordered && !inOrdered) orderedId++;
    inOrdered = ordered;

    switch (d.flavour) {
      case 'affine:paragraph': {
        const t = d.type || 'text';
        const runs = inlineRuns(d.text).map((r) => runXml(r, rels)).join('');
        if (/^h[1-6]$/.test(t)) out.push(para(`Heading${t[1]}`, runs));
        else if (t === 'quote') out.push(para('Quote', runs));
        else out.push(para(null, runs));
        break;
      }
      case 'affine:list': {
        const level = Math.min(d.depth || 0, 8);
        // A checkbox is drawn into the text: Word has no todo list, and a
        // content control would not survive a round trip through most readers.
        const prefix = d.type === 'todo' ? (d.checked ? '☑ ' : '☐ ') : '';
        const runs = inlineRuns(prefix + d.text).map((r) => runXml(r, rels)).join('');
        out.push(para('ListParagraph', runs, listPr(ordered ? orderedId : NUM_BULLET, level)));
        break;
      }
      case 'affine:code': {
        // One paragraph per line: a single paragraph with breaks would let Word
        // reflow the block, and indentation is most of what code means.
        const lines = String(d.text ?? '').split('\n');
        lines.forEach((line, i) => {
          const shade =
            '<w:shd w:val="clear" w:fill="F7F7F9"/>' +
            `<w:spacing w:before="${i === 0 ? 120 : 0}" w:after="${i === lines.length - 1 ? 120 : 0}" w:line="240" w:lineRule="auto"/>`;
          out.push(para('Code', `<w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r>`, shade));
        });
        break;
      }
      case 'affine:divider':
        out.push(
          '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="E4E4E8"/></w:pBdr></w:pPr></w:p>',
        );
        break;
      case 'affine:table':
        if (d.rows?.length) {
          out.push(tableXml(d.rows, rels));
          out.push('<w:p/>'); // two adjacent tables merge into one without a paragraph between
        }
        break;
      default:
        break;
    }
  }
  return out.join('');
}

const STYLES = `${XML_DECL}
<w:styles ${W_NS}>
  <w:docDefaults><w:rPrDefault><w:rPr>
    <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/>
  </w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr>
  </w:style>
  ${[
    [1, 40, true],
    [2, 30, true],
    [3, 26, true],
    [4, 24, true],
    [5, 22, true],
    [6, 22, false],
  ]
    .map(
      ([n, size, bold]) => `<w:style w:type="paragraph" w:styleId="Heading${n}">
    <w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:keepNext/><w:outlineLvl w:val="${n - 1}"/><w:spacing w:before="280" w:after="120"/></w:pPr>
    <w:rPr>${bold ? '<w:b/>' : '<w:i/>'}<w:sz w:val="${size}"/><w:color w:val="1C1C1E"/></w:rPr>
  </w:style>`,
    )
    .join('')}
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:after="240"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="56"/><w:color w:val="1C1C1E"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Quote">
    <w:name w:val="Quote"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:ind w:left="360"/><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="D8D8DC"/></w:pBdr></w:pPr>
    <w:rPr><w:color w:val="4A4A50"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Code">
    <w:name w:val="HTML Preformatted"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="160" w:right="160"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph">
    <w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:after="60"/><w:contextualSpacing/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Caption">
    <w:name w:val="caption"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="0" w:after="240"/></w:pPr>
    <w:rPr><w:sz w:val="18"/><w:color w:val="86868B"/></w:rPr>
  </w:style>
</w:styles>`;

/** Nine indent levels each, because a list can nest deeper than anyone should. */
function numberingXml(orderedCount) {
  const levels = (fmt, text) =>
    Array.from({ length: 9 }, (_, i) => {
      const indent = 720 * (i + 1);
      const bullet = ['●', '○', '▪'][i % 3];
      return `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/>` +
        `<w:lvlText w:val="${fmt === 'bullet' ? bullet : text.replace('%n', `%${i + 1}`)}"/>` +
        `<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${indent}" w:hanging="360"/></w:pPr>` +
        (fmt === 'bullet' ? '<w:rPr><w:rFonts w:ascii="Segoe UI Symbol" w:hAnsi="Segoe UI Symbol"/></w:rPr>' : '') +
        '</w:lvl>';
    }).join('');

  const nums = Array.from(
    { length: orderedCount },
    (_, i) => `<w:num w:numId="${NUM_ORDERED_BASE + i}"><w:abstractNumId w:val="1"/></w:num>`,
  ).join('');

  return `${XML_DECL}
<w:numbering ${W_NS}>
  <w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${levels('bullet', '')}</w:abstractNum>
  <w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${levels('decimal', '%n.')}</w:abstractNum>
  <w:num w:numId="${NUM_BULLET}"><w:abstractNumId w:val="0"/></w:num>
  ${nums}
</w:numbering>`;
}

/**
 * Build a .docx for one document.
 *
 * `loadImage(url)` is how the caller hands over image bytes — the blob store is
 * the server's business, not this module's. It may return null (a missing or
 * unreadable blob), in which case the image degrades to its alt text rather
 * than producing a file Word refuses to open.
 *
 * @returns {Promise<Buffer>}
 */
export async function docxFromMarkdown({ title, markdown, meta, loadImage }) {
  const descs = parseMarkdown(markdown || '').map(imageDescAsParagraph);

  // Resolve every image up front: the XML builder is synchronous, and a
  // half-written relationship is a corrupt file rather than a missing picture.
  const media = new Map(); // url -> { id, cx, cy, index, part }
  if (loadImage) {
    const urls = [...new Set([...String(markdown || '').matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]))];
    for (const url of urls) {
      if (!safeUrl(url)) continue;
      const img = await loadImage(url).catch(() => null);
      if (!img?.data?.length) continue;
      const size = imageSize(img.data);
      const ext = (img.mime || '').includes('png') ? 'png'
        : (img.mime || '').includes('gif') ? 'gif'
        : (img.mime || '').includes('webp') ? 'webp'
        : 'jpeg';
      const index = media.size + 1;
      let cx = (size?.width ?? 480) * EMU_PER_PX;
      let cy = (size?.height ?? 320) * EMU_PER_PX;
      if (cx > MAX_IMAGE_EMU) {
        cy = Math.round((cy * MAX_IMAGE_EMU) / cx);
        cx = MAX_IMAGE_EMU;
      }
      media.set(url, { index, cx, cy, ext, data: img.data });
    }
  }

  // Relationship ids: styles and numbering are fixed, images are next, and
  // external links are allocated as the body is rendered.
  const relParts = [
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>',
  ];
  let nextRel = 3;
  for (const m of media.values()) {
    m.id = `rId${nextRel++}`;
    relParts.push(
      `<Relationship Id="${m.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${m.index}.${m.ext}"/>`,
    );
  }
  const externals = new Map();
  const rels = {
    image: (url) => media.get(url) ?? null,
    external: (url) => {
      if (!externals.has(url)) {
        const id = `rId${nextRel++}`;
        externals.set(url, id);
        relParts.push(
          `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(url)}" TargetMode="External"/>`,
        );
      }
      return externals.get(url);
    },
  };

  const body = bodyXml(descs, rels);
  // Count the ordered-list runs the body allocated, so numbering.xml declares
  // exactly the w:num instances it referenced.
  let orderedCount = 0;
  let inOrdered = false;
  for (const d of descs) {
    const ordered = d.flavour === 'affine:list' && d.type === 'numbered';
    if (ordered && !inOrdered) orderedCount++;
    inOrdered = ordered;
  }

  const document = `${XML_DECL}
<w:document ${W_NS}><w:body>
${para('Title', `<w:r><w:t xml:space="preserve">${esc(title || 'Untitled')}</w:t></w:r>`)}
${meta ? para('Caption', `<w:r><w:t xml:space="preserve">${esc(meta)}</w:t></w:r>`) : ''}
${body}
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;

  const imageTypes = [...new Set([...media.values()].map((m) => m.ext))]
    .map((ext) => `<Default Extension="${ext}" ContentType="image/${ext === 'jpeg' ? 'jpeg' : ext}"/>`)
    .join('');

  const contentTypes = `${XML_DECL}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${imageTypes}
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

  const files = [
    { name: '[Content_Types].xml', data: contentTypes },
    {
      name: '_rels/.rels',
      data: `${XML_DECL}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: STYLES },
    { name: 'word/numbering.xml', data: numberingXml(Math.max(orderedCount, 1)) },
    {
      name: 'word/_rels/document.xml.rels',
      data: `${XML_DECL}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relParts.join('')}</Relationships>`,
    },
    ...[...media.values()].map((m) => ({ name: `word/media/image${m.index}.${m.ext}`, data: m.data })),
  ];

  return zipSync(files);
}
