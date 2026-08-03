import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, topTerms, extractSignals, findMentions, simhash, hamming, keyphrases, summarize } from './intelligence.js';
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

test('tokenize strips urls and extended stopwords', () => {
  assert.deepEqual(tokenize('Visit https://acme.com/path for kubernetes'), ['kubernetes']);
});

test('extractSignals ignores code blocks and template todos', () => {
  const s = extractSignals([
    { flavour: 'affine:code', type: 'plain', checked: false, text: '// TODO: handle null' },
    { flavour: 'affine:list', type: 'todo', checked: false, text: '[Task]' },
    { flavour: 'affine:list', type: 'todo', checked: false, text: 'Ship the release notes' },
  ]);
  assert.equal(s.tasks.length, 1);
  assert.equal(s.tasks[0].text, 'Ship the release notes');
});

test('decisions require a real keyword, not bare future tense', () => {
  const s = extractSignals([
    { flavour: 'affine:paragraph', type: 'text', text: 'We will send you an email shortly.' },
    { flavour: 'affine:paragraph', type: 'text', text: 'We decided to adopt Postgres.' },
  ]);
  assert.equal(s.decisions.length, 1);
});

test('risk text is snippeted, not the whole block', () => {
  const long = 'x '.repeat(400) + 'this is a real risk to the timeline ' + 'y '.repeat(400);
  const s = extractSignals([{ flavour: 'affine:paragraph', type: 'text', text: long }]);
  assert.ok(s.risks[0].text.length <= 210);
  assert.ok(/risk/i.test(s.risks[0].text));
});

test('findMentions is whole-word and skips generic single-word titles', () => {
  const m = findMentions('The roadmap 2026 and the product plan', [
    { id: '1', title: 'Roadmap' },        // whole word present ("roadmap")
    { id: '2', title: 'Product' },        // generic single word → skipped
    { id: '3', title: 'Team' },           // len<5 → skipped
  ]);
  assert.deepEqual(m.map((x) => x.title), ['Roadmap']);
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

test('keyphrases extracts multi-word phrases over stopwords', () => {
  const kp = keyphrases('The kubernetes cluster autoscaler manages the kubernetes cluster nodes and pods.', 5);
  assert.ok(kp.some((p) => p.includes('kubernetes cluster')));
  assert.ok(kp.every((p) => typeof p === 'string' && p.length));
});

test('summarize returns a subset of sentences, capped', () => {
  const t = 'Kubernetes runs containers. The autoscaler adds nodes under load. Cats are unrelated fluff. The cluster scales pods automatically based on demand.';
  const s = summarize(t, 2);
  assert.ok(s.length > 0 && s.length < t.length);
  assert.ok(!/cats are unrelated/i.test(s)); // the off-topic sentence should rank last
});
