// Documents in and out as files: import, and markdown + Word + PDF export.
//
// Every export is server-rendered (`/export.md`, `/export.docx`, `/print`) from
// the stored Yjs state, so they work for any page you can open — not just the
// one currently mounted in the editor.

/**
 * A single import is a document, not a data dump. Matches the server's cap
 * (server/src/import.js) so an oversized file is refused before it is uploaded
 * rather than after.
 */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

/** What the picker offers. The server decides for real, by extension. */
export const IMPORT_ACCEPT =
  '.md,.markdown,.mdown,.txt,.docx,.pdf,text/markdown,text/plain,application/pdf,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function download(id: string, file: 'export.md' | 'export.docx'): void {
  const a = document.createElement('a');
  a.href = `/api/docs/${encodeURIComponent(id)}/${file}`;
  a.download = '';
  a.rel = 'noopener';
  a.click();
}

/** Download a doc as `.md`. The server's Content-Disposition names the file. */
export function downloadMarkdown(id: string): void {
  download(id, 'export.md');
}

/** Download a doc as `.docx` — headings, marks, lists, tables and images intact. */
export function downloadDocx(id: string): void {
  download(id, 'export.docx');
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
 * Ask for files to import. Resolves empty when the picker is dismissed — on
 * browsers without a `cancel` event that just means the promise is dropped,
 * which costs nothing.
 */
export function pickImportFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = IMPORT_ACCEPT;
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
