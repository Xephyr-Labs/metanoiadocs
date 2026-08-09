// Documents in and out as files: markdown import, markdown + PDF export.
//
// Both exports are server-rendered (`/export.md`, `/print`) from the stored Yjs
// state, so they work for any page you can open — not just the one currently
// mounted in the editor.

/** A single import is a document, not a data dump. Anything larger is a mistake. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

const MD_EXTENSIONS = /\.(md|markdown|mdown|txt)$/i;

/** Download a doc as `.md`. The server's Content-Disposition names the file. */
export function downloadMarkdown(id: string): void {
  const a = document.createElement('a');
  a.href = `/api/docs/${encodeURIComponent(id)}/export.md`;
  a.download = '';
  a.rel = 'noopener';
  a.click();
}

/**
 * Open the print-ready render of a doc; the browser's print dialog is what
 * writes the PDF. Server-side PDF generation would mean shipping a headless
 * browser for the same one dialog.
 */
export function printDoc(id: string): void {
  window.open(`/api/docs/${encodeURIComponent(id)}/print`, '_blank', 'noopener');
}

/**
 * Ask for markdown files. Resolves empty when the picker is dismissed — on
 * browsers without a `cancel` event that just means the promise is dropped,
 * which costs nothing.
 */
export function pickMarkdownFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.mdown,.txt,text/markdown,text/plain';
    input.multiple = true;
    input.style.display = 'none';
    const done = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.onchange = () => done(input.files ? [...input.files] : []);
    input.oncancel = () => done([]);
    // Attached, not floating: a detached file input is ignored outright by some
    // browsers, and the picker never opens.
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Drop a YAML front-matter block. Obsidian, Hugo and every static-site export
 * put one at the top, and pasted verbatim it reads as a stray table of keys.
 * Only a `---` on the very first line counts, so a document that merely opens
 * with a divider keeps it.
 */
export function stripFrontMatter(md: string): string {
  const text = md.replace(/^﻿/, '');
  if (!/^---[ \t]*\r?\n/.test(text)) return text;
  // The closing fence is exactly three dashes on their own line — `----` is a
  // divider inside the document, not the end of the block.
  const close = /\n---[ \t]*(\r?\n|$)/.exec(text);
  if (!close) return text;
  return text.slice(close.index + close[0].length).replace(/^\s*\n/, '');
}

/** Title for an imported file: its first H1, else the filename. */
export function titleFromMarkdown(md: string, filename: string): string {
  const h1 = md.split('\n').find((l) => /^#\s+\S/.test(l));
  if (h1) return h1.replace(/^#\s+/, '').trim().slice(0, 200);
  return filename.replace(MD_EXTENSIONS, '').trim().slice(0, 200) || 'Untitled';
}
