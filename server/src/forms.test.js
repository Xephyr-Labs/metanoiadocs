import test from 'node:test';
import assert from 'node:assert/strict';
import { allow, resetLimit, formFields, normalizeFormFields, readAnswers } from './forms.js';

test('a form accepts submissions up to its limit and then refuses', () => {
  resetLimit('t1');
  for (let i = 0; i < 3; i++) assert.equal(allow('t1', 1000, 3), true, `submission ${i + 1}`);
  assert.equal(allow('t1', 1000, 3), false, 'the fourth is refused');
});

test('the window reopens', () => {
  resetLimit('t2');
  assert.equal(allow('t2', 0, 1), true);
  assert.equal(allow('t2', 0, 1), false);
  // An hour later.
  assert.equal(allow('t2', 60 * 60 * 1000 + 1, 1), true);
});

// One noisy form must not close another. The limit protects the database
// behind a link, so it is per link.
test('one form running out does not affect another', () => {
  resetLimit('a');
  resetLimit('b');
  assert.equal(allow('a', 0, 1), true);
  assert.equal(allow('a', 0, 1), false);
  assert.equal(allow('b', 0, 1), true);
});

/* ── the fields a form asks for ──────────────────────────────────────── */

const PROPS = [
  { id: 'p1', label: 'Severity', type: 'select', options: [{ id: 'o1', name: 'High' }] },
  { id: 'p2', label: 'Steps', type: 'text', options: [] },
  { id: 'p3', label: 'Owner', type: 'person', options: [] },
  { id: 'p4', label: 'Screenshot', type: 'file', options: [] },
  { id: 'p5', label: 'Seen on', type: 'date', options: [] },
];

test('a form may ask for the types a stranger can answer, and no others', () => {
  const saved = [{ id: 'p1' }, { id: 'p3' }, { id: 'p4' }, { id: 'p5', required: true }];
  const fields = formFields(saved, PROPS);
  assert.deepEqual(fields.map((f) => f.id), ['p1', 'p5']);
  assert.equal(fields[1].required, true);
  assert.equal(fields[0].options.length, 1);
});

test('a property that has since been deleted is simply not on the form', () => {
  assert.deepEqual(formFields([{ id: 'gone' }, { id: 'p2' }], PROPS).map((f) => f.id), ['p2']);
});

test('saving a field list keeps the askable ones, once each', () => {
  const saved = normalizeFormFields(
    [{ id: 'p2', required: true }, 'p1', { id: 'p2' }, { id: 'p3' }, { id: 'nope' }],
    PROPS,
  );
  assert.deepEqual(saved, [{ id: 'p2', required: true }, { id: 'p1', required: false }]);
});

test('a required field that was left blank stops the submission', () => {
  const fields = formFields([{ id: 'p2', required: true }], PROPS);
  assert.deepEqual(readAnswers(fields, {}), { ok: false, error: 'Steps is needed.' });
  // A space bar is not an answer: it passes a naive non-empty check and then
  // coerces to null, leaving the column the form insisted on empty.
  assert.deepEqual(readAnswers(fields, { p2: '   ' }), { ok: false, error: 'Steps is needed.' });
  assert.deepEqual(readAnswers(fields, { p2: ' it crashed ' }), { ok: true, props: { p2: 'it crashed' } });
});

test('an answer is coerced the way a signed-in write would be', () => {
  const fields = formFields([{ id: 'p5' }], PROPS);
  assert.deepEqual(readAnswers(fields, { p5: '2026-09-22' }), { ok: true, props: { p5: '2026-09-22' } });
  assert.equal(readAnswers(fields, { p5: 'next tuesday' }).ok, false);
});

test('an optional field left blank writes nothing at all', () => {
  const fields = formFields([{ id: 'p2' }, { id: 'p5' }], PROPS);
  assert.deepEqual(readAnswers(fields, { p2: 'it crashed' }), { ok: true, props: { p2: 'it crashed' } });
});

test('answers for fields the form does not have are ignored', () => {
  const fields = formFields([{ id: 'p2' }], PROPS);
  assert.deepEqual(readAnswers(fields, { p2: 'ok', p3: 'someone', gone: 'x' }), { ok: true, props: { p2: 'ok' } });
});

test('a choice has to be one of the choices — there is no picker on a public form', () => {
  const fields = formFields([{ id: 'p1' }], PROPS);
  assert.deepEqual(readAnswers(fields, { p1: 'o1' }), { ok: true, props: { p1: 'o1' } });
  assert.deepEqual(readAnswers(fields, { p1: 'whatever they typed' }),
    { ok: false, error: 'Severity is not one of the choices.' });
});

test('a multi-select answer is checked option by option', () => {
  const props = [{ id: 'm1', label: 'Areas', type: 'multi_select', options: [{ id: 'a' }, { id: 'b' }] }];
  const fields = formFields([{ id: 'm1' }], props);
  assert.equal(readAnswers(fields, { m1: ['a', 'b'] }).ok, true);
  assert.equal(readAnswers(fields, { m1: ['a', 'zzz'] }).ok, false);
});
