#!/usr/bin/env node
// One-time import of the legacy Affine task boards into the tasks tables.
//
// Reads THIS instance's own doc_states — the boards came across whole in the
// migration, so nothing touches the Affine deployment or the taskgantt service.
// One doc holding a dated `affine:database` block becomes one project.
//
//   node scripts/import-boards.mjs --dry-run
//   node scripts/import-boards.mjs --as admin --assignee-map map.json
//   node scripts/import-boards.mjs --force        # re-import docs already done
//
// The assignee cells hold *Affine* user ids, which do not exist here. Pass
// --assignee-map with {"<affine id>": "<username|email|local user id>"}; anything
// unmatched is left unassigned and listed at the end.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pool } from '../src/db.js';
import { docFromState, extractTasks } from '../src/board-decode.js';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const DRY = flag('dry-run');
const FORCE = flag('force');

async function resolveActor(who) {
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE username = $1 OR email = $1 OR id = $1 LIMIT 1`,
    [who]
  );
  return rows[0]?.id ?? null;
}

async function buildAssigneeResolver() {
  const raw = opt('assignee-map');
  const map = raw ? JSON.parse(fs.readFileSync(raw, 'utf8')) : {};
  const { rows } = await pool.query('SELECT id, username, email, name FROM users');
  const local = new Map();
  for (const u of rows) {
    for (const k of [u.id, u.username, u.email, (u.name || '').toLowerCase()]) {
      if (k) local.set(String(k).toLowerCase(), u.id);
    }
  }
  const unmatched = new Set();
  return {
    unmatched,
    resolve(refs) {
      for (const ref of refs) {
        const target = map[ref] ?? ref;
        const hit = local.get(String(target).toLowerCase());
        if (hit) return hit; // tasks carry a single assignee
      }
      if (refs.length) unmatched.add(refs[0]);
      return null;
    },
  };
}

async function main() {
  const actor = await resolveActor(opt('as', 'admin'));
  const assignees = await buildAssigneeResolver();

  const { rows: docs } = await pool.query(
    `SELECT d.id, d.title, d.icon, s.state
       FROM docs d JOIN doc_states s ON s.doc_id = d.id
      WHERE d.deleted_at IS NULL
      ORDER BY d.title`
  );
  const { rows: existing } = await pool.query(
    'SELECT doc_id, id FROM projects WHERE doc_id IS NOT NULL'
  );
  const already = new Map(existing.map((r) => [r.doc_id, r.id]));

  let imported = 0;
  let taskCount = 0;
  let depCount = 0;

  for (const doc of docs) {
    let board;
    try {
      board = extractTasks(docFromState(doc.state));
    } catch (e) {
      console.warn(`  ! ${doc.title}: could not decode (${e.message})`);
      continue;
    }
    if (!board.found || !board.tasks.length) continue;

    const prior = already.get(doc.id);
    if (prior && !FORCE) {
      console.log(`  = ${doc.title}: already imported (${board.tasks.length} rows) — skip`);
      continue;
    }

    console.log(`  ${DRY ? '?' : '+'} ${doc.title}: ${board.tasks.length} tasks` +
      (prior ? ' (re-import)' : ''));
    if (DRY) {
      // Resolve here too, so the unmatched-assignee report is useful *before*
      // committing rather than after.
      for (const t of board.tasks) assignees.resolve(t.assigneeRefs);
      for (const t of board.tasks.slice(0, 5)) {
        console.log(`      ${t.status.padEnd(6)} ${t.startAt || '····-··-··'}→${t.dueAt || '····-··-··'}  ${t.title}`);
      }
      if (board.tasks.length > 5) console.log(`      … ${board.tasks.length - 5} more`);
      imported++;
      taskCount += board.tasks.length;
      depCount += board.tasks.reduce((n, t) => n + t.deps.length, 0);
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (prior) await client.query('DELETE FROM projects WHERE id = $1', [prior]);
      const projectId = crypto.randomUUID();
      await client.query(
        `INSERT INTO projects (id, name, icon, doc_id, created_by) VALUES ($1, $2, $3, $4, $5)`,
        [projectId, board.title || doc.title, doc.icon || '📋', doc.id, actor]
      );

      const idFor = new Map();
      let position = 0;
      for (const t of board.tasks) {
        const id = crypto.randomUUID();
        idFor.set(t.sourceId, id);
        await client.query(
          `INSERT INTO tasks (id, project_id, title, status, assignee_id, start_at, due_at,
                              progress, milestone, position, created_by, updated_by, done_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12)`,
          [
            id, projectId, t.title, t.status, assignees.resolve(t.assigneeRefs),
            t.startAt, t.dueAt, t.progress, t.milestone, position++, actor,
            t.status === 'done' ? new Date() : null,
          ]
        );
      }
      for (const t of board.tasks) {
        for (const dep of t.deps) {
          const from = idFor.get(t.sourceId);
          const to = idFor.get(dep);
          if (!from || !to || from === to) continue;
          await client.query(
            `INSERT INTO task_deps (task_id, depends_on_id) VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [from, to]
          );
          depCount++;
        }
      }
      await client.query('COMMIT');
      imported++;
      taskCount += board.tasks.length;
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`  ! ${doc.title}: import failed — ${e.message}`);
    } finally {
      client.release();
    }
  }

  console.log(
    `\n${DRY ? '[dry run] would import' : 'imported'} ${imported} projects, ` +
    `${taskCount} tasks, ${depCount} dependencies`
  );
  if (assignees.unmatched.size) {
    console.log(`\nunresolved assignee ids (left unassigned) — pass --assignee-map to fix:`);
    for (const id of assignees.unmatched) console.log(`  ${id}`);
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
