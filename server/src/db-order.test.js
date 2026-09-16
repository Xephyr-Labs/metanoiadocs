import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The schema is one statement list, executed top to bottom, in one implicit
 * transaction. On a database that already exists that ordering never shows:
 * every table is there, so an `ALTER TABLE docs` written above `CREATE TABLE
 * docs` succeeds. On a genuinely fresh one it fails, the whole block rolls
 * back, and the instance dies at boot with `relation "docs" does not exist` —
 * which is what shipped, unnoticed, because every machine it was tried on
 * already had a database.
 *
 * So: a static read of db.js, not a live one. A test needing Postgres would not
 * have run in CI, and this bug is only visible on the first boot nobody does.
 */

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'db.js'),
  'utf8'
);

/** The DDL inside `pool.query(\`…\`)`, with SQL comments stripped — a comment
 *  mentioning a table is prose, not a statement. */
function schemaStatements() {
  const start = source.indexOf('await pool.query(`');
  assert.ok(start >= 0, 'initSchema no longer calls pool.query with a template literal');
  const from = start + 'await pool.query(`'.length;
  const end = source.indexOf('`);', from);
  assert.ok(end > from, 'could not find the end of the schema template literal');
  return source
    .slice(from, end)
    .replace(/--[^\n]*/g, '')
    .split(';');
}

test('no statement touches a table before it is created', () => {
  const created = new Set();
  const problems = [];

  for (const statement of schemaStatements()) {
    const sql = statement.trim();
    if (!sql) continue;

    const makes = sql.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/i)?.[1];
    // Everything this statement needs to already exist: the table it alters,
    // the table an index is on, and every table it points a foreign key at.
    const needs = new Set();
    const alters = sql.match(/ALTER TABLE\s+(\w+)/i)?.[1];
    if (alters) needs.add(alters);
    const indexes = sql.match(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS\s+\w+\s+ON\s+(\w+)/i)?.[1];
    if (indexes) needs.add(indexes);
    for (const [, target] of sql.matchAll(/REFERENCES\s+(\w+)\s*\(/gi)) needs.add(target);

    for (const table of needs) {
      // A table may reference itself in its own CREATE — folders.parent_id does.
      if (table === makes) continue;
      if (!created.has(table)) {
        problems.push(`${sql.split('\n')[0].trim().slice(0, 70)}… needs "${table}"`);
      }
    }
    if (makes) created.add(makes);
  }

  assert.deepEqual(problems, [], `statements that run before the table they need:\n  ${problems.join('\n  ')}`);
});

test('every table the schema references is one the schema creates', () => {
  const created = new Set();
  const referenced = new Set();
  for (const statement of schemaStatements()) {
    const makes = statement.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/i)?.[1];
    if (makes) created.add(makes);
    const alters = statement.match(/ALTER TABLE\s+(\w+)/i)?.[1];
    if (alters) referenced.add(alters);
  }
  const missing = [...referenced].filter((t) => !created.has(t));
  assert.deepEqual(missing, [], `altered but never created: ${missing.join(', ')}`);
});
