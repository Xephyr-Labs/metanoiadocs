// One-time migration: convert legacy literal-markdown documents (Affine imports
// stored as raw "#"/pipe text) into proper BlockSuite blocks, in place on the
// same doc GUID so live clients merge it as ordinary edits.
//
// Runs on the HOST (the DB isn't reachable from here directly), driven by TSV:
//   input  TSV: "<doc_id>\t<state base64>" per line  (from psql \copy)
//   output SQL: UPDATE doc_states ... for every doc that changed
//   backup TSV: original "<doc_id>\t<base64>" for every doc that changed
//
// Usage:
//   node scripts/normalize-legacy-docs.mjs --in=all.tsv --sql=apply.sql --backup=backup.tsv [--only=ID,ID]
import fs from 'node:fs';
import { normalizeDocState } from '../src/blocks.js';

const arg = (name, def = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const inPath = arg('in');
const sqlPath = arg('sql');
const backupPath = arg('backup');
const only = arg('only');
const onlySet = only ? new Set(only.split(',')) : null;
if (!inPath || !sqlPath || !backupPath) { console.error('need --in --sql --backup'); process.exit(1); }

const lines = fs.readFileSync(inPath, 'utf8').split('\n').filter(Boolean);
const sql = [];
const backup = [];
let scanned = 0, changed = 0, skipped = 0, failed = 0;

for (const line of lines) {
  const tab = line.indexOf('\t');
  if (tab < 0) continue;
  const id = line.slice(0, tab).trim();
  const b64 = line.slice(tab + 1).trim();
  if (onlySet && !onlySet.has(id)) continue;
  scanned++;
  try {
    const state = Buffer.from(b64, 'base64');
    const out = normalizeDocState(state, { by: 'legacy-normalize', now: 0 });
    if (!out) { skipped++; continue; }
    const newB64 = Buffer.from(out).toString('base64');
    backup.push(`${id}\t${b64}`);
    sql.push(`UPDATE doc_states SET state = decode('${newB64}', 'base64'), updated_at = now() WHERE doc_id = '${id}';`);
    changed++;
  } catch (e) {
    failed++;
    console.error(`FAIL ${id}: ${e.message}`);
  }
}

fs.writeFileSync(sqlPath, sql.join('\n') + (sql.length ? '\n' : ''));
fs.writeFileSync(backupPath, backup.join('\n') + (backup.length ? '\n' : ''));
console.log(`scanned=${scanned} changed=${changed} skipped=${skipped} failed=${failed}`);
console.log(`wrote ${sqlPath} (${sql.length} updates), ${backupPath} (backup)`);
