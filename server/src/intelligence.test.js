import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, topTerms, extractSignals, findMentions, simhash, hamming } from './intelligence.js';
import { buildDocState, extractBlocks } from './blocks.js';

test('tokenize drops stopwords, short words, punctuation', () => {
  assert.deepEqual(tokenize('The Kubernetes cluster is on!'), ['kubernetes', 'cluster']);
});

test('topTerms counts and ranks', () => {
  const t = topTerms('alpha alpha beta', 10);
  assert.deepEqual(t[0], { term: 'alpha', tf: 2 });
});

test('extractSignals pulls tasks/decisions/risks/deadlines', () => {
  const blocks = [
    { flavour: 'affine:list', type: 'todo', checked: false, text: 'ship the rail' },
    { flavour: 'affine:list', type: 'todo', checked: true, text: 'done thing' },
    { flavour: 'affine:paragraph', type: 'text', text: 'We decided to use Postgres.' },
    { flavour: 'affine:paragraph', type: 'text', text: 'Decision: schema TBD' },
    { flavour: 'affine:paragraph', type: 'text', text: 'Main risk is scope creep.' },
    { flavour: 'affine:paragraph', type: 'text', text: 'Due 2026-08-10 for launch.' },
  ];
  const s = extractSignals(blocks);
  assert.deepEqual(s.tasks, [
    { text: 'ship the rail', checked: false },
    { text: 'done thing', checked: true },
  ]);
  assert.equal(s.decisions.length, 2);
  assert.equal(s.decisions.find((d) => /TBD/.test(d.text)).unresolved, true);
  assert.equal(s.risks.length, 1);
  assert.equal(s.deadlines[0].date, '2026-08-10');
});

test('findMentions matches other doc titles, min length 4', () => {
  const m = findMentions('See the Roadmap and the API docs.', [
    { id: '1', title: 'Roadmap' },
    { id: '2', title: 'API' }, // len<4 → ignored
  ]);
  assert.deepEqual(m, [{ id: '1', title: 'Roadmap', count: 1 }]);
});

test('simhash of similar term sets is near, different is far', () => {
  const a = simhash(topTerms('alpha beta gamma delta epsilon', 30));
  const b = simhash(topTerms('alpha beta gamma delta epsilon zeta', 30));
  const c = simhash(topTerms('completely unrelated words here banana', 30));
  // Relative invariant: a near-identical set is closer than an unrelated one.
  assert.ok(hamming(a, b) < hamming(a, c));
});

test('extractBlocks returns todos with checked state and title', () => {
  const state = buildDocState('Plan', '# Heading\n- [ ] open task\n- [x] done task\nplain line');
  const { title, blocks } = extractBlocks(Buffer.from(state));
  assert.equal(title, 'Plan');
  const todos = blocks.filter((b) => b.flavour === 'affine:list' && b.type === 'todo');
  assert.equal(todos.length, 2);
  assert.equal(todos[0].checked, false);
  assert.equal(todos[1].checked, true);
});
