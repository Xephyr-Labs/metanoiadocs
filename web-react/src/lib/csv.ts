// Writing out what is on screen, as the file a spreadsheet opens.
//
// Export happens here rather than on the server for one reason: what a person
// means by "export this" is the view they are looking at — its filters, its
// sort, its visible columns — and every bit of that already lives in the
// browser. A server route would need a second copy of the filter engine, and
// the day the two disagree is the day an export quietly drops rows.
import type { PropRow, TaskRow } from './tasksApi';
import type { UserRow } from './docsApi';
import { REPEAT_LABEL } from './tasksApi';
import { isBuiltinProp, readBuiltin } from './builtinProps';

/** Quote a cell only when it has to be quoted. Mirrors csvCell on the server. */
export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Rows of values to CSV text.
 *
 * CRLF and a byte-order mark, because the next thing that opens this is
 * overwhelmingly likely to be Excel — which reads a BOM-less UTF-8 file in the
 * host's legacy code page and turns every accented name into mojibake.
 */
export function toCsv(rows: unknown[][]): string {
  if (!rows.length) return '';
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/**
 * One cell's worth of a value, whatever type it came from.
 *
 * A list becomes "a, b" rather than JSON: the file is going to a spreadsheet,
 * where a human reads the cell, and `["a","b"]` is not a thing a human reads.
 */
export function cellText(value: unknown, type: string, users: UserRow[], options: PropRow['options'] = []): string {
  if (value === null || value === undefined) return '';
  if (type === 'checkbox') return value ? 'Yes' : 'No';
  // A day, not an instant. Dates arrive from the API as ISO timestamps
  // ("2026-09-14T07:00:00.000Z"), which a spreadsheet shows as that whole
  // string — and which is not what the column means. The first ten characters
  // are the date, and are also what an import reads back.
  if (type === 'date' && typeof value === 'string') return value.slice(0, 10);
  // Built-in columns hand back rows, not ids: `sys:assignees` is a list of
  // people and `sys:tags` a list of tags, each already carrying its name. A
  // property of type person holds ids and needs the lookup. Both arrive here.
  const named = (v: unknown) => (v && typeof v === 'object' && 'name' in v ? String((v as { name: unknown }).name ?? '') : null);
  if (Array.isArray(value) && value.some((v) => named(v) !== null)) {
    return value.map((v) => named(v) ?? '').filter(Boolean).join(', ');
  }
  if (named(value) !== null) return named(value) as string;
  if (type === 'person') {
    const ids = Array.isArray(value) ? value : [value];
    return ids
      .map((id) => users.find((u) => u.id === id)?.name ?? '')
      .filter(Boolean)
      .join(', ');
  }
  if (type === 'select' || type === 'multi_select') {
    const ids = Array.isArray(value) ? value : [value];
    return ids
      .map((id) => options.find((o) => o.id === id)?.label ?? String(id))
      .join(', ');
  }
  if (type === 'file') {
    const files = Array.isArray(value) ? value : [];
    return files.map((f) => (f as { name?: string })?.name ?? '').filter(Boolean).join(', ');
  }
  if (Array.isArray(value)) return value.map((v) => String(v ?? '')).join(', ');
  if (typeof value === 'object') return '';
  return String(value);
}

/**
 * The rows on screen, as a table: a header line of the visible columns, then
 * one line per task in the order they are displayed.
 *
 * `props` is the resolved column list the view is already drawing — built-ins
 * and the database's own, in the order the person arranged them — so the file
 * matches the screen column for column.
 */
export function tasksToRows(tasks: TaskRow[], props: PropRow[], users: UserRow[]): unknown[][] {
  const header = ['Title', ...props.map((p) => p.label)];
  const lines = tasks.map((task) => [
    // The key lives inside the title, so this is the title as it is displayed.
    task.title,
    ...props.map((prop) => {
      const value = isBuiltinProp(prop.id) ? readBuiltin(task, prop.id) : task.props?.[prop.id] ?? null;
      if (prop.id === 'sys:repeat' && typeof value === 'string') return REPEAT_LABEL[value] ?? value;
      return cellText(value, prop.type, users, prop.options);
    }),
  ]);
  return [header, ...lines];
}

/** Hand the browser a file. Nothing to clean up — the URL dies with the tick. */
export function downloadCsv(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
