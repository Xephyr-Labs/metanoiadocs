// Print-ready HTML for a document, used by "Export PDF".
//
// The browser is the PDF engine: this page opens in a tab, calls print(), and
// the user saves it. That keeps a headless Chrome (300MB+ in the image, plus a
// process to babysit) out of the deployment for a feature that is one dialog
// either way. Layout is defined here rather than by @media print rules on the
// app shell, so what gets printed does not depend on the editor's DOM.
import { parseMarkdown, imageDescAsParagraph } from './blocks.js';

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Only http(s) and same-origin paths become links/images. A javascript: or
// data: URL out of a document would execute in our own origin when printed.
const safeUrl = (u) => {
  const s = String(u ?? '').trim();
  return /^(https?:\/\/|\/)/i.test(s) ? esc(s) : '';
};

/**
 * Inline markdown → HTML. Code spans are extracted first and put back last, so
 * a `**` inside backticks stays literal instead of turning bold.
 */
function inline(src) {
  const code = [];
  // NUL-delimited index: a plain " 3 " placeholder would collide with document
  // text, and esc() leaves control characters alone so the marker survives it.
  let s = String(src ?? '').replace(/`([^`]+)`/g, (_, c) => {
    code.push(c);
    return `\x00${code.length - 1}\x00`;
  });
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
    const href = safeUrl(url);
    return href ? `<img alt="${esc(alt)}" src="${href}" />` : esc(alt);
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const href = safeUrl(url);
    return href ? `<a href="${href}">${label}</a>` : label;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\[\[([^\]]+)\]\]/g, '<span class="ref">$1</span>');
  return s.replace(/\x00(\d+)\x00/g, (_, i) => `<code>${esc(code[Number(i)])}</code>`);
}

/** Block descriptors → HTML, grouping runs of list items into real lists. */
function blocksToHtml(descs) {
  const out = [];
  // Each open list remembers its tag so a nested ol inside a ul closes cleanly.
  const open = [];
  const closeTo = (depth) => {
    while (open.length > depth) out.push(`</${open.pop()}>`);
  };

  for (const d of descs) {
    if (d.flavour !== 'affine:list') closeTo(0);

    switch (d.flavour) {
      case 'affine:paragraph': {
        const t = d.type || 'text';
        if (/^h[1-6]$/.test(t)) out.push(`<h${t[1]}>${inline(d.text)}</h${t[1]}>`);
        else if (t === 'quote') out.push(`<blockquote>${inline(d.text)}</blockquote>`);
        else out.push(`<p>${inline(d.text) || '&nbsp;'}</p>`);
        break;
      }
      case 'affine:list': {
        const tag = d.type === 'numbered' ? 'ol' : 'ul';
        // An item can only nest one level deeper than the list it is in; close
        // anything deeper than that, but keep the list at this level open so a
        // numbered list doesn't restart at 1 after a nested item.
        const depth = Math.min(d.depth || 0, open.length);
        closeTo(depth + 1);
        if (open.length === depth + 1 && open[depth] !== tag) out.push(`</${open.pop()}>`);
        if (open.length === depth) { out.push(`<${tag}>`); open.push(tag); }
        const box = d.type === 'todo'
          ? `<input type="checkbox" disabled${d.checked ? ' checked' : ''} /> `
          : '';
        out.push(`<li class="${d.type}">${box}${inline(d.text)}</li>`);
        break;
      }
      case 'affine:code':
        out.push(`<pre><code>${esc(d.text)}</code></pre>`);
        break;
      case 'affine:divider':
        out.push('<hr />');
        break;
      case 'affine:table': {
        const [head, ...body] = d.rows;
        out.push('<table><thead><tr>');
        for (const c of head) out.push(`<th>${inline(c)}</th>`);
        out.push('</tr></thead><tbody>');
        for (const row of body) {
          out.push('<tr>');
          for (let i = 0; i < head.length; i++) out.push(`<td>${inline(row[i] ?? '')}</td>`);
          out.push('</tr>');
        }
        out.push('</tbody></table>');
        break;
      }
      default:
        break;
    }
  }
  closeTo(0);
  return out.join('\n');
}

const CSS = `
@page { margin: 18mm 16mm; }
* { box-sizing: border-box; }
body {
  margin: 0 auto; padding: 32px 24px 64px; max-width: 46rem;
  font: 15px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
  color: #1c1c1e; background: #fff;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 .5em; font-weight: 650; break-after: avoid; }
h1 { font-size: 2em; margin-top: 0; }
h2 { font-size: 1.45em; }
h3 { font-size: 1.2em; }
h4, h5, h6 { font-size: 1.05em; }
p { margin: 0 0 .9em; }
ul, ol { margin: 0 0 .9em; padding-left: 1.5em; }
li { margin: .2em 0; }
li.todo { list-style: none; margin-left: -1.2em; }
blockquote { margin: 1em 0; padding: .2em 0 .2em 1em; border-left: 3px solid #d8d8dc; color: #4a4a50; }
hr { border: 0; border-top: 1px solid #e4e4e8; margin: 2em 0; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em; background: #f4f4f6; padding: .12em .35em; border-radius: 4px; }
pre { background: #f7f7f9; border: 1px solid #ebebef; border-radius: 8px; padding: 12px 14px; overflow-x: auto; break-inside: avoid; }
pre code { background: none; padding: 0; font-size: .85em; line-height: 1.55; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: .92em; break-inside: avoid; }
th, td { border: 1px solid #e4e4e8; padding: 6px 10px; text-align: left; vertical-align: top; }
th { background: #f7f7f9; font-weight: 600; }
img { max-width: 100%; height: auto; break-inside: avoid; }
a { color: #1b64da; text-decoration: none; }
.ref { color: #1b64da; }
.doc-meta { margin: -.4em 0 2em; color: #86868b; font-size: .85em; }
@media print {
  body { padding: 0; max-width: none; }
  a { color: inherit; text-decoration: underline; }
  .doc-meta { color: #6b6b70; }
}
`;

/**
 * A standalone HTML page for one document. `auto` makes it open the print
 * dialog on load, which is the whole point when it is opened from "Export PDF".
 */
export function printHtml({ title, icon, markdown, meta, auto = true }) {
  const body = blocksToHtml(parseMarkdown(markdown).map(imageDescAsParagraph));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title || 'Untitled')}</title>
<style>${CSS}</style>
</head>
<body>
<h1>${icon ? `${esc(icon)} ` : ''}${esc(title || 'Untitled')}</h1>
${meta ? `<p class="doc-meta">${esc(meta)}</p>` : ''}
${body}
${auto ? '<script>addEventListener("load", () => window.print());</script>' : ''}
</body>
</html>`;
}
