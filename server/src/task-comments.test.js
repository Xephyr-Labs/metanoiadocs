import test from 'node:test';
import assert from 'node:assert/strict';
import { recipientsFor } from './task-comments.js';

const base = {
  handles: [],
  byHandle: new Map(),
  assigneeIds: [],
  creatorId: null,
  participantIds: [],
  authorId: 'me',
};

test('nobody hears about their own comment', () => {
  const out = recipientsFor({
    ...base,
    handles: ['me'],
    byHandle: new Map([['me', 'me']]),
    assigneeIds: ['me'],
    creatorId: 'me',
    participantIds: ['me'],
  });
  assert.equal(out.size, 0);
});

test('whoever is carrying the task is told, and whoever asked for it', () => {
  const out = recipientsFor({ ...base, assigneeIds: ['ada'], creatorId: 'rima' });
  assert.deepEqual([...out], [['ada', 'comment'], ['rima', 'comment']]);
});

test('anyone who has already spoken in the thread stays in it', () => {
  const out = recipientsFor({ ...base, participantIds: ['ada', 'rima'] });
  assert.deepEqual([...out.keys()], ['ada', 'rima']);
});

test('a mention is not demoted to "commented on" by also being the assignee', () => {
  const out = recipientsFor({
    ...base,
    handles: ['ada'],
    byHandle: new Map([['ada', 'ada']]),
    assigneeIds: ['ada'],
  });
  assert.deepEqual([...out], [['ada', 'mention']]);
});

test('an unknown handle is simply not a recipient', () => {
  const out = recipientsFor({ ...base, handles: ['nobody'] });
  assert.equal(out.size, 0);
});

test('one person, told once, however many ways they are involved', () => {
  const out = recipientsFor({
    ...base,
    assigneeIds: ['ada', 'ada'],
    creatorId: 'ada',
    participantIds: ['ada'],
  });
  assert.equal(out.size, 1);
});
