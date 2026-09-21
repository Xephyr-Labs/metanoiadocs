import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toCsv, csvCell, mapColumns, normalizeHeader } from './csv.js';

test('plain rows', () => {
  assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('CRLF reads the same as LF', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
});

test('a trailing newline does not invent a row', () => {
  assert.equal(parseCsv('a,b\n1,2\n').length, 2);
  assert.equal(parseCsv('a,b\n1,2').length, 2);
});

test('quotes hide the separator, the newline and each other', () => {
  assert.deepEqual(
    parseCsv('title,notes\n"Fix, urgently","line one\nline two"\n"He said ""no""",x'),
    [['title', 'notes'], ['Fix, urgently', 'line one\nline two'], ['He said "no"', 'x']],
  );
});

test('an empty cell is a cell', () => {
  assert.deepEqual(parseCsv('a,,c'), [['a', '', 'c']]);
  assert.deepEqual(parseCsv(',,'), [['', '', '']]);
});

test("Excel's byte-order mark is not part of the first header", () => {
  const [[first]] = parseCsv('﻿Title,Status\nx,todo');
  assert.equal(first, 'Title');
});

test('writing quotes only what needs it', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('has,comma'), '"has,comma"');
  assert.equal(csvCell('has"quote'), '"has""quote"');
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
  assert.equal(csvCell(null), '');
});

test('a round trip keeps every cell intact', () => {
  const rows = [
    ['Title', 'Notes', 'Points'],
    ['Fix, urgently', 'line one\nline two', '3'],
    ['He said "no"', '', ''],
  ];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});

test('an empty export is empty, not a blank line', () => {
  assert.equal(toCsv([], { bom: false }), '');
});

test('headers match properties by label, whatever the case and spacing', () => {
  const props = [{ id: 'p1', label: 'Owner', type: 'person' }, { id: 'p2', label: 'Ship date', type: 'date' }];
  const map = mapColumns(['Title', ' owner ', 'SHIP DATE', 'Colour', ''], props);
  assert.deepEqual(map.map((c) => c.kind), ['builtin', 'prop', 'prop', 'new', 'skip']);
  assert.equal(map[0].field, 'title');
  assert.equal(map[1].propId, 'p1');
  assert.equal(map[2].propId, 'p2');
});

test('a built-in beats a property of the same name, and says which it shadowed', () => {
  // A database whose owner made their own "Status" select is ordinary. A
  // Status column in a spreadsheet still means the state the board groups by,
  // and sending it to the lookalike leaves every row in To do.
  const [col] = mapColumns(['Status'], [{ id: 'p9', label: 'Status', type: 'select' }]);
  assert.equal(col.kind, 'builtin');
  assert.equal(col.field, 'status');
  assert.equal(col.shadows, 'p9');
});

test('a built-in with no lookalike shadows nothing', () => {
  const [col] = mapColumns(['Points'], [{ id: 'p1', label: 'Owner', type: 'person' }]);
  assert.equal(col.shadows, null);
});

test('header normalisation collapses the whitespace people paste', () => {
  assert.equal(normalizeHeader('  Due   Date \n'), 'due date');
});
