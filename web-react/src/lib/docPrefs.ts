/**
 * Reading preferences for the document surface: face, body size, measure.
 *
 * They are per person and apply to every page, not per page like Notion's —
 * there is no per-document settings column to hang them on, and a preference
 * someone sets because their eyes are tired is one they want on the next page
 * too. `ponytail: app-wide in localStorage; move to a per-page column if the
 * team ever wants "this design doc is full-width for everyone".`
 *
 * Font and size are applied as data attributes on <html> and drawn by CSS in
 * index.css; full width stays in the workspace store because the editor takes
 * it as a prop. This module owns the storage keys either way, so the page menu,
 * the settings dialog and the pre-paint restore in main.tsx cannot drift apart.
 */

export type DocFont = 'default' | 'serif' | 'mono';

const FONT_KEY = 'mn-doc-font';
const SIZE_KEY = 'mn-text-size';
const WIDTH_KEY = 'mn-full-width';

/** localStorage throws in a private window with site data blocked, and every
 *  one of these reads runs during the first paint. A preference is never worth
 *  a blank app, so each accessor falls back to the default. */
function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function write(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* Preference not remembered; the session still honours it. */
  }
}

/** Anything can be in localStorage — a half-written value, a key from a build
 *  that shipped a face we no longer have. Unknown reads as the default rather
 *  than reaching the stylesheet as a selector that matches nothing. */
export function parseFont(v: string | null | undefined): DocFont {
  return v === 'serif' || v === 'mono' ? v : 'default';
}

export function docFont(): DocFont {
  return parseFont(read(FONT_KEY));
}

export function setDocFont(font: DocFont): void {
  write(FONT_KEY, font === 'default' ? '' : font);
  applyDocFont(font);
}

export function applyDocFont(font: DocFont = docFont()): void {
  document.documentElement.dataset.docFont = font === 'default' ? '' : font;
}

export function smallText(): boolean {
  return read(SIZE_KEY) === 'small';
}

export function setSmallText(on: boolean): void {
  write(SIZE_KEY, on ? 'small' : '');
  applySmallText(on);
}

export function applySmallText(on: boolean = smallText()): void {
  document.documentElement.dataset.textSize = on ? 'small' : '';
}

export function fullWidth(): boolean {
  return read(WIDTH_KEY) === '1';
}

export function setFullWidthStored(on: boolean): void {
  write(WIDTH_KEY, on ? '1' : '');
}
