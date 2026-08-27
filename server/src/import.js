// File import — one document in, markdown out.
//
// Markdown is what the rest of the app speaks: buildDocState turns it into the
// Yjs state, docx.js and print.js render from it. So every format converges
// here and nothing downstream needs to know an import happened.
//
// This lives on the server rather than in the browser because .docx and .pdf
// are binary — the client cannot read them without shipping parsers — and
// because putting it here means the API and the MCP get import too, instead of
// it being something only the web UI can do.
import { docxToMarkdown } from './docx-import.js';
import { pdfToMarkdown } from './pdf.js';

/** Extensions we accept, for the picker's filter and the 415 message alike. */
export const IMPORT_EXTENSIONS = ['.md', '.markdown', '.mdown', '.txt', '.docx', '.pdf'];

/**
 * A single import is a document, not a data dump — but a PDF of any length runs
 * to megabytes, so this is the blob endpoint's limit rather than the 2 MB the
 * markdown-only import used to enforce.
 */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

const TEXT_EXTENSIONS = /\.(md|markdown|mdown|txt)$/i;
const ANY_EXTENSION = /\.[^.]+$/;

/**
 * Drop a YAML front-matter block. Obsidian, Hugo and every static-site export
 * put one at the top, and pasted verbatim it reads as a stray table of keys.
 * Only a `---` on the very first line counts, so a document that merely opens
 * with a divider keeps it.
 */
export function stripFrontMatter(md) {
  const text = md.replace(/^﻿/, '');
  if (!/^---[ \t]*\r?\n/.test(text)) return text;
  // The closing fence is exactly three dashes on their own line — `----` is a
  // divider inside the document, not the end of the block.
  const close = /\n---[ \t]*(\r?\n|$)/.exec(text);
  if (!close) return text;
  return text.slice(close.index + close[0].length).replace(/^\s*\n/, '');
}

/** Title for an imported file: its first H1, else the filename. */
export function titleFromMarkdown(md, filename) {
  const h1 = md.split('\n').find((l) => /^#\s+\S/.test(l));
  if (h1) return h1.replace(/^#\s+/, '').trim().slice(0, 200);
  return filename.replace(ANY_EXTENSION, '').trim().slice(0, 200) || 'Untitled';
}

/** The extension, lowercased, including the dot. '' when there isn't one. */
const extensionOf = (name) => (ANY_EXTENSION.exec(name || '')?.[0] || '').toLowerCase();

/**
 * Convert one uploaded file to markdown.
 *
 * @param {{name: string, bytes: Buffer,
 *          saveImage?: (bytes: Buffer, name: string) => Promise<string|null>}} file
 * @returns {Promise<{title: string, markdown: string, warnings: string[]}>}
 * @throws with a message meant for the person who chose the file
 */
export async function fileToMarkdown({ name, bytes, saveImage }) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Error(`${name || 'That file'} is empty.`);
  if (bytes.length > MAX_IMPORT_BYTES) {
    throw new Error(`${name} is larger than ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)} MB.`);
  }

  const ext = extensionOf(name);
  let markdown;
  let warnings = [];

  if (TEXT_EXTENSIONS.test(ext)) {
    markdown = bytes.toString('utf8');
  } else if (ext === '.docx') {
    ({ markdown, warnings } = await docxToMarkdown(bytes, { saveImage }));
  } else if (ext === '.pdf') {
    ({ markdown, warnings } = await pdfToMarkdown(bytes));
  } else if (ext === '.doc') {
    // Worth its own message: .doc and .docx look like the same thing to
    // everyone except the parser, and "unsupported file type" would read as a
    // bug when Word documents are advertised as supported.
    throw new Error(
      'This is the older .doc format, which cannot be read. Open it in Word and "Save As" .docx first.',
    );
  } else {
    throw new Error(`Cannot import ${ext || 'that file'}. Accepted: ${IMPORT_EXTENSIONS.join(', ')}.`);
  }

  markdown = stripFrontMatter(markdown).replace(/\r\n?/g, '\n');
  if (!markdown.trim()) throw new Error(`${name} has no text in it.`);

  return { title: titleFromMarkdown(markdown, name), markdown, warnings };
}
