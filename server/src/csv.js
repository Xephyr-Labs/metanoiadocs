// Reading and writing CSV, the format every spreadsheet already speaks.
//
// A database here can be filled by hand, by the API, by an agent and by a
// public form — and not from the file the work already lives in, which for most
// teams is a sheet. That is the gap this closes, and it closes it without a
// grid: a column of a spreadsheet is a property, a row is a task, and the
// mapping is the whole feature.
//
// RFC 4180 with the two concessions every real file needs: CRLF or LF, and a
// leading BOM (Excel writes one, and a header of "﻿Title" matches nothing).

/**
 * Split CSV text into rows of strings.
 *
 * Hand-written rather than a dependency: the grammar is quotes, doubled quotes
 * and separators, and a parser for it is shorter than the argument about which
 * library to add. Everything it does not understand — types, dates, numbers —
 * is somebody else's job, so every cell comes back as a string.
 */
export function parseCsv(text, sep = ',') {
  const src = String(text ?? '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  // True once anything at all has been seen on this row, so a trailing newline
  // at the end of a file does not produce a final row of one empty cell.
  let started = false;

  const endCell = () => { row.push(cell); cell = ''; started = true; };
  const endRow = () => { endCell(); rows.push(row); row = []; started = false; };

  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        // A doubled quote is one quote; a lone one ends the quoted run.
        if (src[i + 1] === '"') { cell += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      cell += c; i += 1; continue;
    }
    if (c === '"' && cell === '') { quoted = true; started = true; i += 1; continue; }
    if (c === sep) { endCell(); i += 1; continue; }
    if (c === '\r') { i += 1; continue; }
    if (c === '\n') { endRow(); i += 1; continue; }
    cell += c; started = true; i += 1;
  }
  if (started || cell !== '' || row.length) endRow();
  return rows;
}

/** Quote a cell only when it needs it, which keeps a diff of two exports small. */
export function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Rows of values to CSV text.
 *
 * CRLF and a BOM, because the overwhelmingly likely next step is Excel, which
 * reads a BOM-less UTF-8 file as the host's legacy code page and turns every
 * name with an accent in it into mojibake.
 */
export function toCsv(rows, { bom = true } = {}) {
  const body = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  return (bom ? '﻿' : '') + body + (rows.length ? '\r\n' : '');
}

/** Header cells, lowercased and stripped, for matching against property labels. */
export const normalizeHeader = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The built-in columns an import understands, mapped to what the create route
 * calls them. Anything not in here and not a property label is a column the
 * caller is offered as a new property.
 */
export const BUILTIN_COLUMNS = {
  title: 'title',
  name: 'title',
  status: 'status',
  priority: 'priority',
  assignee: 'assignees',
  assignees: 'assignees',
  'start date': 'startAt',
  start: 'startAt',
  'due date': 'dueAt',
  due: 'dueAt',
  points: 'points',
  estimate: 'estimateH',
  'estimate (h)': 'estimateH',
  'estimate hours': 'estimateH',
  hours: 'estimateH',
  type: 'kind',
  kind: 'kind',
  repeat: 'repeatRule',
  notes: 'notes',
  description: 'notes',
  details: 'notes',
};

/**
 * Work out what each header cell means, given a database's properties.
 *
 * Returns one entry per column in file order, so a caller can report "column 4
 * was ignored" by position rather than by guessing. `kind: 'new'` is a column
 * that matched nothing — the caller decides whether to create a property for it
 * or skip it, because silently creating columns from a typo'd header is how a
 * database ends up with "Ownr".
 */
export function mapColumns(headers, props) {
  const byLabel = new Map(props.map((p) => [normalizeHeader(p.label), p]));
  return headers.map((raw) => {
    const key = normalizeHeader(raw);
    if (!key) return { header: raw, kind: 'skip' };
    const prop = byLabel.get(key);
    // The built-in wins a name it shares with a property, and the caller is
    // told so. A database whose owner made their own "Status" select is common
    // — Notion encourages it — and a Status column from a spreadsheet almost
    // always means the state the board is grouped by. Sending it to the
    // lookalike property instead leaves every imported row sitting in To do
    // with the real value hidden in a column nobody groups by, and the import
    // reports success. Shadowing is stated in the preview so the choice is
    // visible before anything is written.
    if (BUILTIN_COLUMNS[key]) {
      return { header: raw, kind: 'builtin', field: BUILTIN_COLUMNS[key], shadows: prop?.id ?? null };
    }
    if (prop) return { header: raw, kind: 'prop', propId: prop.id, type: prop.type };
    return { header: raw, kind: 'new' };
  });
}
