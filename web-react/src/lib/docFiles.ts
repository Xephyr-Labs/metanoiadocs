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

/** The zip sources the picker offers beyond single files. */
export type ArchiveKind = 'confluence' | 'obsidian' | 'markdown';

/** A whole space or vault is mostly attachments; matches server MAX_ARCHIVE_BYTES. */
export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

export interface ImportSource {
  id: 'files' | ArchiveKind;
  label: string;
  /** One line on how to get the file out of the other tool. */
  how: string;
  accept: string;
}

export const IMPORT_SOURCES: ImportSource[] = [
  { id: 'files', label: 'Documents', how: 'Markdown, Word, PDF or text files — pick as many as you like.', accept: IMPORT_ACCEPT },
  { id: 'confluence', label: 'Confluence space', how: 'In the space: Space tools → Content tools → Export → HTML, then pick the .zip.', accept: '.zip,application/zip' },
  { id: 'obsidian', label: 'Obsidian vault', how: 'Zip the vault folder (links, embeds and attachments come across; .obsidian is skipped).', accept: '.zip,application/zip' },
  { id: 'markdown', label: 'Markdown folder (Slab, wikis)', how: 'Slab: Settings → Export. Any folder of .md files with relative links works — zip it.', accept: '.zip,application/zip' },
];

// Which archive source a picked file came from. A WeakMap rather than a field
// on File, so the six places that call pickImportFiles() and hand the result
// to importFiles() stay exactly as they were.
const archiveKinds = new WeakMap<File, ArchiveKind>();
export const archiveKindOf = (file: File): ArchiveKind | undefined => archiveKinds.get(file);

/** Event the ImportSourceDialog (mounted once, in App) answers. */
export const IMPORT_PICKER_EVENT = 'import-picker';
export interface ImportPickerRequest { resolve: (files: File[]) => void }

/** Open the browser's file chooser for one source. Needs the click that called it. */
export function chooseFiles(source: ImportSource): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = source.accept;
    input.multiple = source.id === 'files';
    input.style.display = 'none';
    const done = (files: File[]) => {
      input.remove();
      if (source.id !== 'files') for (const f of files) archiveKinds.set(f, source.id);
      resolve(files);
    };
    input.onchange = () => done(input.files ? [...input.files] : []);
    input.oncancel = () => done([]);
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Ask what to import, then for the files. Resolves empty when the dialog or
 * the chooser is dismissed — on browsers without a `cancel` event that just
 * means the promise is dropped, which costs nothing.
 */
export function pickImportFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent<ImportPickerRequest>(IMPORT_PICKER_EVENT, { detail: { resolve } }));
  });
}
