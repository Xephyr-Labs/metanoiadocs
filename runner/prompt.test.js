import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt } from './prompt.js';

const task = { title: 'Fix the date picker', project_name: 'Web', status: 'todo', kind: 'bug', due_at: '2026-10-01' };

test('an assigned task leads with what it is and ends with what to do', () => {
  const p = buildPrompt({ trigger: 'assign', prompt: 'Fix the date picker', task, page: null });
  assert.match(p, /^# Fix the date picker/);
  assert.match(p, /- Database: Web/);
  assert.match(p, /- Due: 2026-10-01/);
  assert.match(p, /assigned to you/);
});

test('a mention carries what was actually said, and who said it', () => {
  const p = buildPrompt({
    trigger: 'mention',
    prompt: '@bot can you draft the migration?',
    task,
    requestedBy: { name: 'Ada' },
  });
  assert.match(p, /@-mentioned by Ada/);
  assert.match(p, /> @bot can you draft the migration\?/);
  // The ask replaces the generic "this is yours", it does not sit beside it.
  assert.doesNotMatch(p, /assigned to you/);
});

test("the page's text is included when there is any", () => {
  const p = buildPrompt({ trigger: 'assign', prompt: '', task, page: { text: 'Repro: open in Safari.' } });
  assert.match(p, /## The page\n\nRepro: open in Safari\./);
  // An empty page adds no empty section.
  const bare = buildPrompt({ trigger: 'assign', prompt: '', task, page: { text: '   ' } });
  assert.doesNotMatch(bare, /## The page/);
});

test('a run with no task at all is still a usable prompt', () => {
  const p = buildPrompt({ trigger: 'manual', prompt: 'Summarise this page.', task: null, page: null });
  assert.match(p, /## What to do\n\nSummarise this page\./);
});
