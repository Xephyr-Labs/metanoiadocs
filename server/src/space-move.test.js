import test from 'node:test';
import assert from 'node:assert/strict';
import { spaceForNew, reparentInto } from './space-move.js';

// A stand-in for a pg client: answers the handful of queries these helpers send
// from an in-memory workspace, and records every write.
function stubClient({ spaces = ['G', 'M'], spaceOf = {}, graph = { docs: [], folders: [], projects: [], tasks: [] } } = {}) {
  const writes = [];
  const query = async (sql, params = []) => {
    if (sql.startsWith('INSERT INTO spaces')) return { rows: [], rowCount: 0 };
    if (sql.includes('FROM spaces WHERE is_default')) return { rows: [{ id: 'G' }] };
    if (sql.includes('FROM spaces WHERE id = $1')) {
      const n = spaces.includes(params[0]) ? 1 : 0;
      return { rows: n ? [{}] : [], rowCount: n };
    }
    if (sql.startsWith('SELECT space_id FROM')) {
      const s = spaceOf[params[0]];
      return { rows: s === undefined ? [] : [{ space_id: s }] };
    }
    if (sql.startsWith('SELECT id, parent_id, folder_id, kind FROM docs')) return { rows: graph.docs };
    if (sql.startsWith('SELECT id, parent_id FROM folders')) return { rows: graph.folders };
    if (sql.startsWith('SELECT id, parent_id, doc_id FROM projects')) return { rows: graph.projects };
    if (sql.startsWith('SELECT project_id, doc_id FROM tasks')) return { rows: graph.tasks };
    if (sql.startsWith('UPDATE')) { writes.push(sql); return { rows: [], rowCount: 0 }; }
    throw new Error(`unexpected query: ${sql}`);
  };
  return { query, writes };
}

test('an old client that names no space gets the default', async () => {
  assert.equal(await spaceForNew(stubClient(), {}), 'G');
  assert.equal(await spaceForNew(stubClient(), { requested: '' }), 'G');
});
test('an unknown requested space falls through to the default, not an error', async () => {
  assert.equal(await spaceForNew(stubClient(), { requested: 'nope' }), 'G');
});
test('a real requested space is used; the parent and the folder beat it', async () => {
  assert.equal(await spaceForNew(stubClient(), { requested: 'M' }), 'M');
  assert.equal(await spaceForNew(stubClient(), { parentSpace: 'P', requested: 'M' }), 'P');
  assert.equal(await spaceForNew(stubClient(), { folderSpace: 'F', requested: 'M' }), 'F');
  assert.equal(await spaceForNew(stubClient(), { requested: 'nope', fallback: 'T' }), 'T');
});

const graph = {
  docs: [
    { id: 'host', parent_id: null, folder_id: null, kind: 'doc' },
    { id: 'tp', parent_id: 'host', folder_id: null, kind: 'task' },
    { id: 'plain', parent_id: null, folder_id: null, kind: 'doc' },
  ],
  folders: [],
  projects: [{ id: 'P', parent_id: null, doc_id: null }],
  tasks: [{ project_id: 'P', doc_id: 'tp' }],
};

test('reparent: no target or the same space moves nothing', async () => {
  const c = stubClient({ spaceOf: { plain: 'G' }, graph });
  assert.equal(await reparentInto(c, { type: 'doc', id: 'plain' }, null), 'same');
  assert.equal(await reparentInto(c, { type: 'doc', id: 'plain' }, 'G'), 'same');
  assert.deepEqual(c.writes, []);
});
test('reparent: a tree carrying a task page is refused and nothing is written', async () => {
  const c = stubClient({ spaceOf: { host: 'G' }, graph });
  assert.equal(await reparentInto(c, { type: 'doc', id: 'host' }, 'M'), 'owned');
  assert.deepEqual(c.writes, []);
});
test('reparent: a cross-space page moves (dry run writes nothing)', async () => {
  const dry = stubClient({ spaceOf: { plain: 'G' }, graph });
  assert.equal(await reparentInto(dry, { type: 'doc', id: 'plain' }, 'M', { dryRun: true }), 'move');
  assert.deepEqual(dry.writes, []);
  const c = stubClient({ spaceOf: { plain: 'G' }, graph });
  assert.equal(await reparentInto(c, { type: 'doc', id: 'plain' }, 'M'), 'move');
  assert.ok(c.writes.some((w) => w.startsWith('UPDATE docs SET space_id')));
});
