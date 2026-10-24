import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSpace, collectMove, isProjectOwnedPage, carriesProjectPage, byJoinedFirst, taskInScope, spaceInput, tasksInAllSpaces } from './spaces.js';

test('a sub-item takes its parent space before anything else', () => {
  assert.equal(resolveSpace({ parentSpace: 'p', folderSpace: 'f', requested: 'r', fallback: 'g' }), 'p');
  assert.equal(resolveSpace({ folderSpace: 'f', requested: 'r', fallback: 'g' }), 'f');
  assert.equal(resolveSpace({ requested: 'r', fallback: 'g' }), 'r');
  assert.equal(resolveSpace({ requested: '', fallback: 'g' }), 'g');
});
const g = {
  docs: [
    { id: 'a', parent_id: null, folder_id: 'F', kind: 'doc' }, { id: 'a1', parent_id: 'a', folder_id: 'G', kind: 'doc' },
    { id: 'b', parent_id: null, folder_id: 'F2', kind: 'doc' }, { id: 'x', parent_id: 'z', folder_id: 'F', kind: 'doc' },
    { id: 'z', parent_id: null, folder_id: null, kind: 'doc' }, { id: 't1', parent_id: null, folder_id: null, kind: 'task' },
    { id: 'linked', parent_id: null, folder_id: null, kind: 'doc' }, { id: 'src', parent_id: null, folder_id: null, kind: 'doc' },
  ],
  folders: [{ id: 'F', parent_id: null }, { id: 'F2', parent_id: 'F' }, { id: 'G', parent_id: null }],
  projects: [{ id: 'P', parent_id: null, doc_id: 'src' }, { id: 'P2', parent_id: 'P', doc_id: null }],
  tasks: [{ project_id: 'P2', doc_id: 't1' }, { project_id: 'P', doc_id: 'linked' }],
};
test('a page takes its sub-pages, and leaves a folder that stays behind', () => {
  const m = collectMove(g, { type: 'doc', id: 'a' });
  assert.deepEqual(m.docIds.sort(), ['a', 'a1']);
  assert.deepEqual(m.clearFolderDocIds.sort(), ['a', 'a1']);
});
test('a folder takes sub-folders and top-level pages, not a sub-page whose parent is elsewhere', () => {
  const m = collectMove(g, { type: 'folder', id: 'F' });
  assert.deepEqual(m.folderIds.sort(), ['F', 'F2']);
  assert.deepEqual(m.docIds.sort(), ['a', 'a1', 'b']);
  // a1's folder G is not moving; x stays behind (its parent z does) but was filed in F, which is.
  assert.deepEqual(m.clearFolderDocIds.sort(), ['a1', 'x']);
});
test('a project takes sub-projects, its source page and task pages, not an ordinary linked page', () => {
  const m = collectMove(g, { type: 'project', id: 'P' });
  assert.deepEqual(m.projectIds.sort(), ['P', 'P2']);
  assert.deepEqual(m.docIds.sort(), ['src', 't1']);
});
test('task pages and source pages belong to their project', () => {
  assert.equal(isProjectOwnedPage(g, 't1'), true);
  assert.equal(isProjectOwnedPage(g, 'src'), true);
  assert.equal(isProjectOwnedPage(g, 'linked'), false);
});
test('a doc or folder move that would carry a database page is refused; a project carries its own', () => {
  const h = {
    docs: [
      { id: 'srcPage', parent_id: null, folder_id: 'FS', kind: 'doc' },
      { id: 'plain', parent_id: null, folder_id: 'FP', kind: 'doc' },
      { id: 'host', parent_id: null, folder_id: null, kind: 'doc' },
      { id: 'tp', parent_id: 'host', folder_id: null, kind: 'task' },
    ],
    folders: [{ id: 'FS', parent_id: null }, { id: 'FP', parent_id: null }],
    projects: [{ id: 'P', parent_id: null, doc_id: 'srcPage' }],
    tasks: [{ project_id: 'P', doc_id: 'tp' }],
  };
  assert.equal(carriesProjectPage(h, { type: 'folder', id: 'FS' }), true); // holds a source page
  assert.equal(carriesProjectPage(h, { type: 'doc', id: 'host' }), true); // sub-page is a task page
  assert.equal(carriesProjectPage(h, { type: 'folder', id: 'FP' }), false);
  assert.equal(carriesProjectPage(h, { type: 'doc', id: 'plain' }), false);
  assert.equal(carriesProjectPage(h, { type: 'project', id: 'P' }), false);
});
test('joined spaces first, order kept within each group', () => {
  const rows = [{ id: 1, space_id: 'o' }, { id: 2, space_id: 'j' }, { id: 3, space_id: 'o' }, { id: 4, space_id: 'j' }];
  assert.deepEqual(byJoinedFirst(rows, new Set(['j'])).map((r) => r.id), [2, 4, 1, 3]);
});
test('a space needs a name', () => {
  assert.deepEqual(spaceInput({ name: '  ' }), { error: 'Give the space a name.' });
  assert.equal(spaceInput({ name: ' Marketing ' }).name, 'Marketing');
  assert.equal(spaceInput({ name: 'x'.repeat(200) }).name.length, 80);
  assert.deepEqual(spaceInput({ name: 'A', icon: ' 🚀 ', description: ' hi ' }), { name: 'A', icon: '🚀', description: 'hi' });
  assert.deepEqual(spaceInput({ name: 'A' }), { name: 'A', icon: '🗂️', description: '' });
});

test('a task shows when its space is joined, or it is mine', () => {
  const joined = new Set(['j']);
  assert.equal(taskInScope({ spaceId: 'o', assigned: true, createdByMe: false }, joined), true);
  assert.equal(taskInScope({ spaceId: 'o', assigned: false, createdByMe: true }, joined), true);
  assert.equal(taskInScope({ spaceId: 'j', assigned: false, createdByMe: false }, joined), true);
  assert.equal(taskInScope({ spaceId: 'o', assigned: false, createdByMe: false }, joined), false);
});

test('a move detaches every moved item whose parent stays behind, and nothing nested inside the set', () => {
  const h = {
    docs: [
      { id: 'host', parent_id: null, folder_id: null, kind: 'doc' },
      { id: 'src', parent_id: 'host', folder_id: null, kind: 'doc' }, { id: 'srcKid', parent_id: 'src', folder_id: null, kind: 'doc' },
      { id: 't1', parent_id: 'host', folder_id: null, kind: 'task' },
      { id: 'a', parent_id: 'host', folder_id: null, kind: 'doc' }, { id: 'a1', parent_id: 'a', folder_id: null, kind: 'doc' },
    ],
    folders: [{ id: 'Top', parent_id: null }, { id: 'F', parent_id: 'Top' }, { id: 'F1', parent_id: 'F' }],
    projects: [{ id: 'Up', parent_id: null, doc_id: null }, { id: 'P', parent_id: 'Up', doc_id: 'src' }, { id: 'P2', parent_id: 'P', doc_id: null }],
    tasks: [{ project_id: 'P2', doc_id: 't1' }],
  };
  const p = collectMove(h, { type: 'project', id: 'P' });
  assert.deepEqual(p.detach.docs.sort(), ['src', 't1']); // both hung under host, which stays
  assert.deepEqual(p.detach.projects, ['P']);
  assert.deepEqual(collectMove(h, { type: 'doc', id: 'a' }).detach.docs, ['a']); // the root, as before
  const f = collectMove(h, { type: 'folder', id: 'F' });
  assert.deepEqual(f.detach.folders, ['F']);
  assert.deepEqual(f.detach.docs, []);
});
test('agents and ?spaces=all see every space\'s tasks; people see theirs', () => {
  assert.equal(tasksInAllSpaces({ kind: 'agent' }, {}), true);
  assert.equal(tasksInAllSpaces({ kind: 'person' }, { spaces: 'all' }), true);
  assert.equal(tasksInAllSpaces({ kind: 'person' }, {}), false);
  assert.equal(tasksInAllSpaces({}, { spaces: 'joined' }), false);
});
