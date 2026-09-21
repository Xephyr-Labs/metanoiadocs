import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRowTemplate, checkTemplateFields, TEMPLATE_FIELDS, retitleState } from './templates.js';
import { buildDocState, extractText } from './blocks.js';

test('a template fills in what the request left out', () => {
  const out = applyRowTemplate({ title: 'Sprint review' }, { fields: { status: 'doing', priority: 3 }, props: {} });
  assert.equal(out.title, 'Sprint review');
  assert.equal(out.status, 'doing');
  assert.equal(out.priority, 3);
});

test('the request always wins', () => {
  const out = applyRowTemplate({ status: 'todo', priority: 0 }, { fields: { status: 'done', priority: 4 }, props: {} });
  assert.equal(out.status, 'todo');
  assert.equal(out.priority, 0);
});

test('a false or empty value is still an answer, not an absence', () => {
  const out = applyRowTemplate({ milestone: false, title: '' }, { fields: { milestone: true, title: 'Weekly sync' }, props: {} });
  assert.equal(out.milestone, false);
  assert.equal(out.title, '');
});

test('properties merge, and the request wins per property', () => {
  const out = applyRowTemplate(
    { props: { p1: 'mine' } },
    { fields: {}, props: { p1: 'theirs', p2: 'kept' } },
  );
  assert.deepEqual(out.props, { p1: 'mine', p2: 'kept' });
});

test('a template cannot preset a field that is not on the list', () => {
  const out = applyRowTemplate({}, { fields: { createdBy: 'someone-else', docId: 'x', startAt: '2026-03-04' }, props: {} });
  assert.equal(out.createdBy, undefined);
  assert.equal(out.docId, undefined);
  assert.equal(out.startAt, undefined, 'dates are deliberately not presettable');
});

test('the list stays closed', () => {
  for (const field of ['createdBy', 'docId', 'projectId', 'startAt', 'dueAt', 'templateId']) {
    assert.ok(!TEMPLATE_FIELDS.includes(field), `${field} must not be presettable`);
  }
});

test('a template with no fields at all changes nothing', () => {
  const body = { title: 'x', props: { a: 1 } };
  assert.deepEqual(applyRowTemplate(body, {}), body);
});

test('a copied page carries the new title, not the one it was copied from', () => {
  const state = buildDocState('Weekly sync — template', '## Agenda\n\n- one\n- two\n');
  const copy = retitleState(state, 'Weekly sync — 22 September');
  const { title, text } = extractText(Buffer.from(copy));
  assert.equal(title, 'Weekly sync — 22 September');
  assert.doesNotMatch(`${title} ${text}`, /template/);
  // The body is the point of copying, so it has to survive the retitle.
  assert.match(text, /Agenda/);
  assert.match(text, /one/);
});

test('retitling an untitled page is not an error', () => {
  const state = buildDocState('', 'just a paragraph');
  const { title, text } = extractText(Buffer.from(retitleState(state, 'Named at last')));
  assert.equal(title, 'Named at last');
  assert.match(text, /just a paragraph/);
});

/* ── what a template is allowed to hold ──────────────────────────────── */

const KINDS = [{ key: 'task' }, { key: 'bug' }];
const isStatus = (s) => ['todo', 'doing', 'review', 'done'].includes(s);
const check = (fields) => checkTemplateFields(fields, { kinds: KINDS, isStatus });

test('a rule that is not a rule is refused when the template is saved', async () => {
  // Not when it is used: that complained about something the person clicking
  // New had never typed.
  assert.deepEqual(await check({ repeatRule: 'fortnightly' }), { ok: false, error: 'bad repeat rule' });
  assert.equal((await check({ repeatRule: 'weekdays' })).fields.repeatRule, 'weekdays');
});

test('a status or type this database does not have is refused', async () => {
  assert.equal((await check({ status: 'bogus' })).error, 'bad status');
  assert.equal((await check({ kind: 'nonexistent' })).error, 'no such type in this database');
  assert.equal((await check({ status: 'doing', kind: 'bug' })).ok, true);
});

test('numbers are numbers, and are clamped to what the column takes', async () => {
  assert.equal((await check({ priority: 'high' })).error, 'priority has to be a number');
  assert.equal((await check({ priority: 99 })).fields.priority, 4);
  assert.equal((await check({ estimateH: -5 })).fields.estimateH, 0);
  assert.equal((await check({ estimateH: 2.46 })).fields.estimateH, 2.5);
});

test('only the closed list survives', async () => {
  const { fields } = await check({ createdBy: 'someone', docId: 'x', dueAt: '2026-03-04', milestone: true });
  assert.deepEqual(Object.keys(fields), ['milestone']);
});

test('a repeat rule saved before this check is dropped rather than carried', () => {
  const out = applyRowTemplate({}, { fields: { repeatRule: 'fortnightly', status: 'doing' }, props: {} });
  assert.equal(out.repeatRule, undefined);
  assert.equal(out.status, 'doing', 'the rest of the template still applies');
});
