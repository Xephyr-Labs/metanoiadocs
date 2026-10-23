import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSpace, collectMove, isProjectOwnedPage, byJoinedFirst } from './spaces.js';

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
  assert.deepEqual(m.clearFolderDocIds, ['a1']); // a1's folder G is not moving
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
test('joined spaces first, order kept within each group', () => {
  const rows = [{ id: 1, space_id: 'o' }, { id: 2, space_id: 'j' }, { id: 3, space_id: 'o' }, { id: 4, space_id: 'j' }];
  assert.deepEqual(byJoinedFirst(rows, new Set(['j'])).map((r) => r.id), [2, 4, 1, 3]);
});
