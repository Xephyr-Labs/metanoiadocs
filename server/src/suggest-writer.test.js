import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { buildDocState, docToMarkdown } from './blocks.js';
import { decide, decideAll, listSuggestions, pendingText } from './inline-suggest.js';
import { suggestMarkdown } from './suggest-writer.js';

const page = (md) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, buildDocState('T', md));
  return doc;
};
const read = (doc, by = null) => docToMarkdown(Y.encodeStateAsUpdate(doc), { escape: true, withPendingFor: by }).markdown;
const write = (doc, markdown, over = {}) => suggestMarkdown({ doc, markdown, mode: 'replace', by: 'andy', title: 'T', ...over });
/** Count Yjs updates while `fn` runs. */
const updates = (doc, fn) => {
  let n = 0;
  const on = () => { n++; };
  doc.on('update', on);
  try { fn(); } finally { doc.off('update', on); }
  return n;
};
const texts = (doc) => [...doc.getMap('blocks').values()].map((b) => b.get('prop:text')).filter((t) => t instanceof Y.Text);
const cards = (doc) => listSuggestions(doc).map(({ kind, by, before, after }) => ({ kind, by, before, after }));

const RICH = [
  '## Plan', '', 'The **quick** brown fox, with a [link](https://x.y) and `code`.', '',
  '- one', '  - nested', '- two', '', '1. first', '2. second', '', '- [x] done', '- [ ] open', '',
  '> quoted', '', '```js', 'const a = 1;', '```', '', '---', '', '| a | b |', '| --- | --- |', '| 1 | 2 |', '',
].join('\n');

test('replace with read_doc\'s own output changes nothing', () => {
  const doc = page(RICH);
  let out;
  assert.equal(updates(doc, () => { out = write(doc, read(doc, 'andy')); }), 0);
  assert.deepEqual(out, { changes: 0, ids: [] });
});

test('changing one word is one replace card, and the page reads as before for everyone else', () => {
  const doc = page('The quick brown fox.\n\nSecond line.\n');
  const before = read(doc);
  const out = write(doc, 'The slow brown fox.\n\nSecond line.\n');
  assert.deepEqual(cards(doc), [{ kind: 'replace', by: 'andy', before: 'quick', after: 'slow' }]);
  assert.equal(out.changes, 1);
  assert.deepEqual(out.ids, [listSuggestions(doc)[0].id]);
  assert.equal(read(doc), before);
  assert.equal(read(doc, 'andy'), 'The slow brown fox.\n\nSecond line.');
});

test('words replaced side by side are one card', () => {
  const doc = page('The quick brown fox.\n');
  write(doc, 'The slow red fox.\n');
  assert.deepEqual(cards(doc), [{ kind: 'replace', by: 'andy', before: 'quick brown', after: 'slow red' }]);
});

test('quote, dash and whitespace-only differences are no change', () => {
  const doc = page('It’s “fine” — really.\n\nNext para.\n');
  let out;
  assert.equal(updates(doc, () => { out = write(doc, 'It\'s "fine" - really.  \n\n\nNext   para.\n'); }), 0);
  assert.equal(out.changes, 0);
});

test('writing the same thing twice touches nothing the second time', () => {
  const doc = page('The quick brown fox.\n');
  const a = write(doc, 'The slow brown fox jumps.\n\nAdded.\n');
  let b;
  assert.equal(updates(doc, () => { b = write(doc, read(doc, 'andy')); }), 0);
  assert.deepEqual(b, a);
});

test('a second write that reverts a word withdraws the earlier suggestion', () => {
  const doc = page('The quick brown fox.\n');
  write(doc, 'The slow brown fox.\n');
  const out = write(doc, 'The quick brown fox.\n');
  assert.deepEqual(listSuggestions(doc), []);
  assert.equal(out.changes, 0);
  assert.equal(texts(doc).find((t) => /fox/.test(t.toString())).toString(), 'The quick brown fox.');
});

test('a second write that changes the replacement keeps the card and its id', () => {
  const doc = page('The quick brown fox.\n');
  const [id] = write(doc, 'The slow brown fox.\n').ids;
  write(doc, 'The sleepy brown fox.\n');
  assert.deepEqual(cards(doc), [{ kind: 'replace', by: 'andy', before: 'quick', after: 'sleepy' }]);
  assert.equal(listSuggestions(doc)[0].id, id);
});

test('other people\'s pending suggestions are left alone', () => {
  const doc = page('Alpha beta gamma.\n\nDelta epsilon.\n');
  const t = texts(doc).find((x) => /Alpha/.test(x.toString()));
  t.insert(5, ' new', { mnSugg: { id: 'u2-ins', kind: 'ins', by: 'u2', at: 1 } });
  t.format(11, 4, { mnSugg: { id: 'u2-del', kind: 'del', by: 'u2', at: 1 } }); // "beta"
  const theirs = cards(doc);
  const andySees = read(doc, 'andy');
  assert.equal(andySees, 'Alpha beta gamma.\n\nDelta epsilon.');
  write(doc, andySees.replace('gamma', 'GAMMA').replace('epsilon', 'zeta'));
  const after = cards(doc);
  assert.deepEqual(after.filter((c) => c.by === 'u2'), theirs);
  assert.deepEqual(after.filter((c) => c.by === 'andy').map((c) => [c.before, c.after]), [['gamma', 'GAMMA'], ['epsilon', 'zeta']]);
});

test('andy deleting text someone else suggested deleting leaves their suggestion as it was', () => {
  const doc = page('Alpha beta gamma.\n');
  const t = texts(doc).find((x) => /Alpha/.test(x.toString()));
  t.format(6, 4, { mnSugg: { id: 'u2-del', kind: 'del', by: 'u2', at: 1 } });
  write(doc, 'Alpha gamma.\n');
  assert.deepEqual(cards(doc), [{ kind: 'delete', by: 'u2', before: 'beta', after: '' }]);
});

test('a heading level change is one type card', () => {
  const doc = page('## Section\n\nBody.\n');
  write(doc, '### Section\n\nBody.\n');
  assert.deepEqual(cards(doc), [{ kind: 'type', by: 'andy', before: 'h2', after: 'h3' }]);
  write(doc, '## Section\n\nBody.\n');
  assert.deepEqual(cards(doc), [], 'changing it back withdraws it');
});

test('an appended paragraph is one add, in replace and in append mode', () => {
  const doc = page('Intro.\n');
  const out = write(doc, 'Intro.\n\nAdded paragraph.\n');
  assert.deepEqual(cards(doc), [{ kind: 'add', by: 'andy', before: '', after: 'Added paragraph.' }]);
  assert.equal(out.changes, 1);
  assert.equal(read(doc), 'Intro.');
  const doc2 = page('Intro.\n');
  const out2 = write(doc2, 'Appended.\n', { mode: 'append' });
  assert.deepEqual(cards(doc2), [{ kind: 'add', by: 'andy', before: '', after: 'Appended.' }]);
  assert.equal(out2.changes, 1);
  assert.equal(read(doc2, 'andy'), 'Intro.\n\nAppended.');
});

test('a missing paragraph is one remove; writing it back withdraws it', () => {
  const doc = page('Keep.\n\nDrop me.\n');
  write(doc, 'Keep.\n');
  assert.deepEqual(cards(doc), [{ kind: 'remove', by: 'andy', before: 'Drop me.', after: '' }]);
  write(doc, 'Keep.\n\nDrop me.\n');
  assert.deepEqual(cards(doc), []);
});

test('dropping an added paragraph withdraws it', () => {
  const doc = page('Intro.\n');
  write(doc, 'Intro.\n\nAdded.\n');
  write(doc, 'Intro.\n');
  assert.deepEqual(cards(doc), []);
  assert.equal(read(doc, 'andy'), 'Intro.');
});

test('a change inside a code block is that block removed and the new one added (R7)', () => {
  const doc = page('```js\nconst a = 1;\n```\n');
  write(doc, '```js\nconst a = 2;\n```\n');
  assert.deepEqual(cards(doc).map((c) => c.kind), ['remove', 'add']);
  assert.ok(texts(doc).every((t) => !t.toDelta().some((op) => op.attributes?.mnSugg)));
});

test('Ask AI marks carry via ai; accepting them gives the asked-for text', () => {
  const doc = page('The quick brown fox.\n');
  const { ids } = write(doc, 'The slow brown fox.\n', { by: 'p1', via: 'ai' });
  assert.equal(listSuggestions(doc)[0].via, 'ai');
  decide(doc, ids[0], 'accept');
  assert.equal(read(doc), 'The slow brown fox.');
});

test('inserted text takes its own formatting, not its neighbour\'s', () => {
  const doc = page('Some **bold** words.\n');
  write(doc, 'Some **bold** plain words.\n');
  const t = texts(doc).find((x) => /bold/.test(x.toString()));
  const ins = t.toDelta().find((op) => op.attributes?.mnSugg?.kind === 'ins');
  assert.equal(ins.insert, 'plain ');
  assert.equal(ins.attributes.bold, undefined);
});

test('direct: a trusted replace keeps everyone\'s pending suggestions', () => {
  const doc = page('Alpha beta gamma.\n\nSecond.\n');
  const t = texts(doc).find((x) => /Alpha/.test(x.toString()));
  t.insert(5, ' new', { mnSugg: { id: 'u2-ins', kind: 'ins', by: 'u2', at: 1 } });
  const theirs = cards(doc);
  const out = suggestMarkdown({ doc, markdown: 'Alpha beta delta.\n\nSecond, edited.\n', mode: 'replace', by: 'owner', title: 'T', direct: true });
  assert.deepEqual(cards(doc), theirs);
  assert.equal(read(doc), 'Alpha beta delta.\n\nSecond, edited.');
  assert.equal(pendingText(t), 'Alpha beta delta.');
  assert.equal(out.changes, 0);
});

test('decide refuses a verdict other than accept or reject', () => {
  const doc = page('x\n');
  assert.throws(() => decide(doc, 'nope', 'maybe'), /verdict/);
  assert.throws(() => decideAll(doc, 'nope'), /verdict/);
});

test('an edit in a nested list item is one card in that item', () => {
  const doc = page('- one\n  - nested item\n- two\n');
  write(doc, '- one\n  - nested thing\n- two\n');
  assert.deepEqual(cards(doc), [{ kind: 'replace', by: 'andy', before: 'item', after: 'thing' }]);
});

test('someone else\'s added block and an empty line the editor left are not touched', () => {
  const doc = page('First.\n\nSecond.\n');
  const blocks = doc.getMap('blocks');
  const note = [...blocks.values()].find((b) => b.get('sys:flavour') === 'affine:note');
  const theirs = suggestMarkdown({ doc, markdown: 'Their block.\n', mode: 'append', by: 'u2', title: 'T' });
  const empty = new Y.Map();
  blocks.set('empty1', empty);
  empty.set('sys:id', 'empty1'); empty.set('sys:flavour', 'affine:paragraph'); empty.set('prop:type', 'text');
  empty.set('sys:children', new Y.Array()); empty.set('prop:text', new Y.Text());
  note.get('sys:children').push(['empty1']);
  const out = write(doc, 'First.\n\nSecond, changed.\n');
  assert.deepEqual(cards(doc).filter((c) => c.by === 'u2').map((c) => c.id ?? c.kind), ['add']);
  assert.ok(listSuggestions(doc).some((c) => c.id === theirs.ids[0]));
  assert.ok(blocks.get('empty1') && !blocks.get('empty1').get('prop:mnSugg'));
  assert.equal(out.changes, 1);
});

test('a page with no body note is refused', () => {
  const doc = new Y.Doc();
  doc.getMap('blocks').set('p', new Y.Map());
  assert.throws(() => write(doc, 'x\n'), /no body/);
});

test('an indentation change in code is a change, not whitespace noise', () => {
  const doc = page('```py\nif x:\n    y()\n```\n');
  write(doc, '```py\nif x:\ny()\n```\n');
  assert.deepEqual(cards(doc).map((c) => c.kind), ['remove', 'add']);
});

// ── fix round 1 ──────────────────────────────────────────────────────────────

test('rewriting one sentence is one suggestion on that sentence', () => {
  const doc = page('The team will ship the new onboarding flow to all users by the end of next week, after a final review of the copy.\n');
  const out = write(doc, 'The team plans to ship the redesigned onboarding flow to every user by Friday, once the copy has been reviewed.\n');
  assert.equal(out.changes, 1);
  const [c] = cards(doc);
  assert.equal(c.kind, 'replace');
  assert.equal(c.before, 'will ship the new onboarding flow to all users by the end of next week, after a final review of the copy');
  assert.equal(c.after, 'plans to ship the redesigned onboarding flow to every user by Friday, once the copy has been reviewed');
});

test('a one-word typo fix is one small card', () => {
  const doc = page('We will revew the plan with the whole team before the launch next month.\n');
  write(doc, 'We will review the plan with the whole team before the launch next month.\n');
  assert.deepEqual(cards(doc).map((c) => [c.before, c.after]), [['revew', 'review']]);
});

test('two unrelated one-word fixes in two sentences are two cards', () => {
  const doc = page('The budget is aproved for the quarter. Hiring starts in Febuary with two roles.\n');
  write(doc, 'The budget is approved for the quarter. Hiring starts in February with two roles.\n');
  assert.deepEqual(cards(doc).map((c) => [c.before, c.after]), [['aproved', 'approved'], ['Febuary', 'February']]);
});

test('a hunk never carries an unchanged space at its edges', () => {
  const doc = page('Ship it on Monday morning.\n');
  write(doc, 'Ship it on Tuesday afternoon.\n');
  assert.deepEqual(cards(doc).map((c) => [c.before, c.after]), [['Monday morning', 'Tuesday afternoon']]);
});

const tickCards = (doc) => listSuggestions(doc).map(({ kind, by, ticked, text }) => ({ kind, by, ticked, text }));

test('R13b: a tick is an in-place mark on the same block; accept keeps it, reject unticks', () => {
  for (const verdict of ['accept', 'reject']) {
    const doc = page('- [ ] open task\n- [ ] other\n');
    const before = [...doc.getMap('blocks').keys()].sort();
    const out = write(doc, '- [x] open task\n- [ ] other\n');
    assert.equal(out.changes, 1);
    assert.deepEqual([...doc.getMap('blocks').keys()].sort(), before, 'no copy');
    assert.deepEqual(tickCards(doc), [{ kind: 'type', by: 'andy', ticked: true, text: 'open task' }]);
    assert.equal(read(doc), '- [ ] open task\n- [ ] other');
    assert.equal(read(doc, 'andy'), '- [x] open task\n- [ ] other');
    decide(doc, out.ids[0], verdict);
    assert.equal(read(doc), `- [${verdict === 'accept' ? 'x' : ' '}] open task\n- [ ] other`);
    assert.deepEqual(listSuggestions(doc), []);
  }
});

test('R13b: unticking back withdraws the tick; unticking a done item is an untick card', () => {
  const doc = page('- [ ] open task\n- [x] done task\n');
  write(doc, '- [x] open task\n- [ ] done task\n');
  assert.deepEqual(tickCards(doc).map((c) => [c.ticked, c.text]), [[true, 'open task'], [false, 'done task']]);
  write(doc, '- [ ] open task\n- [x] done task\n');
  assert.deepEqual(listSuggestions(doc), []);
});

test('R13b: docToMarkdown shows the old tick to everyone, the new one to its author', () => {
  const doc = page('- [ ] open task\n');
  write(doc, '- [x] open task\n');
  assert.equal(read(doc), '- [ ] open task');
  assert.equal(read(doc, 'u2'), '- [ ] open task');
  assert.equal(read(doc, 'andy'), '- [x] open task');
});

test('R13b direct: a trusted writer\'s tick applies', () => {
  const doc = page('- [ ] open task\n\nPara.\n');
  const t = texts(doc).find((x) => x.toString() === 'Para.');
  t.insert(0, 'New ', { mnSugg: { id: 'u2-ins', kind: 'ins', by: 'u2', at: 1 } });
  suggestMarkdown({ doc, markdown: '- [x] open task\n\nPara.\n', mode: 'replace', by: 'owner', title: 'T', direct: true });
  assert.equal(read(doc), '- [x] open task\n\nPara.');
  assert.equal(cards(doc).length, 1);
});

test('direct: editing a block someone suggested removing or retyping keeps their suggestion', () => {
  const doc = page('Remove me please.\n\n## Retype me\n\nOther.\n');
  const blocks = doc.getMap('blocks');
  const byText = (s) => [...blocks.values()].find((b) => b.get('prop:text')?.toString() === s);
  byText('Remove me please.').set('prop:mnSugg', { id: 'u2-rm', kind: 'remove', by: 'u2', at: 1 });
  const h = byText('Retype me');
  h.set('prop:type', 'h3');
  h.set('prop:mnSugg', { id: 'u2-ty', kind: 'type', by: 'u2', at: 1, from: { flavour: 'affine:paragraph', type: 'h2' } });
  assert.equal(read(doc), 'Remove me please.\n\n## Retype me\n\nOther.');
  suggestMarkdown({ doc, markdown: 'Remove me now.\n\n## Retype this\n\nOther.\n', mode: 'replace', by: 'owner', title: 'T', direct: true });
  assert.equal(read(doc), 'Remove me now.\n\n## Retype this\n\nOther.');
  assert.deepEqual(listSuggestions(doc).map((c) => [c.id, c.kind]), [['u2-rm', 'remove'], ['u2-ty', 'type']]);
  assert.equal(h.get('prop:type'), 'h3');
});

/** A to-do where u2 suggested inserting "big " and deleting "task". */
function u2Todo() {
  const doc = page('- [ ] open task\n- [ ] other\n');
  const t = texts(doc).find((x) => x.toString() === 'open task');
  t.insert(0, 'big ', { mnSugg: { id: 'u2-ins', kind: 'ins', by: 'u2', at: 1 } });
  t.format(9, 4, { mnSugg: { id: 'u2-del', kind: 'del', by: 'u2', at: 1 } }); // "task"
  return { doc, t };
}

test('R13b: a tick keeps another user\'s pending ins and del in the item, whichever way it is decided', () => {
  for (const verdict of ['accept', 'reject']) {
    const { doc } = u2Todo();
    const theirs = cards(doc);
    assert.deepEqual(theirs.map((c) => [c.kind, c.before, c.after]), [['insert', '', 'big '], ['delete', 'task', '']]);
    const { ids } = write(doc, read(doc, 'andy').replace('- [ ] open', '- [x] open'));
    assert.equal(ids.length, 1);
    assert.deepEqual(cards(doc).filter((c) => c.by === 'u2'), theirs);
    decide(doc, ids[0], verdict);
    assert.deepEqual(cards(doc), theirs);
    assert.equal(decide(doc, 'u2-ins', 'accept'), true);
    assert.equal(decide(doc, 'u2-del', 'accept'), true);
    assert.equal(read(doc), `- [${verdict === 'accept' ? 'x' : ' '}] big open \n- [ ] other`); // "task" deleted, its space kept
    assert.deepEqual(listSuggestions(doc), []);
  }
});

test('R13b: tick, then a rewrite of the item: one tick card plus one text card, no copies, u2 intact', () => {
  for (const [v1, v2] of [['accept', 'accept'], ['reject', 'reject'], ['accept', 'reject']]) {
    const { doc } = u2Todo();
    const blocks = [...doc.getMap('blocks').keys()].sort();
    write(doc, read(doc, 'andy').replace('- [ ] open', '- [x] open'));
    write(doc, read(doc, 'andy').replace('open', 'opened'));
    assert.deepEqual([...doc.getMap('blocks').keys()].sort(), blocks, 'no copies');
    const andy = listSuggestions(doc).filter((c) => c.by === 'andy');
    assert.deepEqual(andy.map((c) => [c.kind, c.before, c.after]), [['replace', 'open', 'opened'], ['type', 'todo', 'todo']]);
    decide(doc, andy[1].id, v1);
    decide(doc, andy[0].id, v2);
    assert.deepEqual(listSuggestions(doc).map((c) => c.id), ['u2-ins', 'u2-del']);
    assert.equal(read(doc), `- [${v1 === 'accept' ? 'x' : ' '}] ${v2 === 'accept' ? 'opened' : 'open'} task\n- [ ] other`);
  }
});

test('R13b: a tick together with a text change is one tick card and one text card', () => {
  const doc = page('- [ ] open task\n');
  const out = write(doc, '- [x] shut task\n');
  assert.deepEqual(listSuggestions(doc).map((c) => [c.kind, c.before, c.after, c.ticked]), [['replace', 'open', 'shut', undefined], ['type', 'todo', 'todo', true]]);
  assert.equal(out.changes, 2);
});

test('R13b: a second suggester writing an item under someone else\'s pending tick makes no copy', () => {
  const doc = page('- [ ] open task\n');
  write(doc, '- [x] open task\n');
  const blocks = [...doc.getMap('blocks').keys()].sort();
  write(doc, '- [x] open job\n', { by: 'u2' });
  assert.deepEqual([...doc.getMap('blocks').keys()].sort(), blocks, 'no copy');
  assert.deepEqual(listSuggestions(doc).map((c) => [c.by, c.kind, c.before, c.after]),
    [['u2', 'replace', 'task', 'job'], ['andy', 'type', 'todo', 'todo']]);
});

test('R14: a type wish dropped under someone else\'s pending type mark is reported as skipped', () => {
  const doc = page('## Retype me\n\nOther.\n');
  const [id, h] = [...doc.getMap('blocks').entries()].find(([, b]) => b.get('prop:text')?.toString() === 'Retype me');
  h.set('prop:type', 'h3');
  h.set('prop:mnSugg', { id: 'u2-ty', kind: 'type', by: 'u2', at: 1, from: { flavour: 'affine:paragraph', type: 'h2' } });
  const out = write(doc, '# Retype me\n\nOther.\n');
  assert.deepEqual(out.skipped, [{ blockId: id, reason: 'someone else\'s change to this block\'s type is pending; yours was not written' }]);
  assert.equal(h.get('prop:type'), 'h3');
  // Wanting what is already pending, or what was read, loses nothing: not reported.
  assert.equal(write(doc, '### Retype me\n\nOther.\n').skipped, undefined);
  assert.equal(write(doc, '## Retype me\n\nOther.\n').skipped, undefined);
});

test('R14: a tick dropped under someone else\'s pending tick is reported; agreeing with it is not', () => {
  const doc = page('- [ ] open task\n');
  write(doc, '- [x] open task\n', { by: 'u2' });
  assert.equal(write(doc, '- [x] open task\n').skipped, undefined);
  const id = [...doc.getMap('blocks').entries()].find(([, b]) => b.get('prop:text')?.toString() === 'open task')[0];
  const h = doc.getMap('blocks').get(id);
  h.set('prop:type', 'numbered');
  h.set('prop:mnSugg', { ...h.get('prop:mnSugg'), from: { flavour: 'affine:list', type: 'todo', checked: false } });
  // u2 now suggests numbered+ticked; andy wants a bullet: dropped and reported.
  assert.deepEqual(write(doc, '- open task\n').skipped?.map((s) => s.blockId), [id]);
});
