import { describe, expect, it } from 'vitest';
import { nextSeen, notifyText, unseen } from './desktopNotify';
import type { InboxRow } from './docsApi';

const row = (over: Partial<InboxRow>): InboxRow => ({
  id: 'n1', kind: 'mention', comment_id: null, actor_name: 'Shafin', body: 'have a look',
  read_at: null, created_at: '2026-09-09T10:00:00.000Z', doc_id: 'd1', doc_title: 'Spec',
  doc_icon: '📄', task_id: null, task_title: null, project_id: null, ...over,
});

describe('unseen', () => {
  it('shows nothing on a device that has never polled', () => {
    expect(unseen([row({})], null)).toEqual([]);
  });

  it('shows a row that arrives after an inbox that was empty', () => {
    // The case a timestamp watermark gets wrong: nothing to anchor to.
    expect(unseen([row({ id: 'first' })], []).map((r) => r.id)).toEqual(['first']);
  });

  it('skips rows already shown', () => {
    const rows = [row({ id: 'old' }), row({ id: 'new', created_at: '2026-09-09T11:00:00.000Z' })];
    expect(unseen(rows, ['old']).map((r) => r.id)).toEqual(['new']);
  });

  it('returns a burst oldest first', () => {
    const rows = [
      row({ id: 'b', created_at: '2026-09-09T12:00:00.000Z' }),
      row({ id: 'a', created_at: '2026-09-09T11:00:00.000Z' }),
    ];
    expect(unseen(rows, []).map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('nextSeen', () => {
  it('banks the whole inbox on the first pass', () => {
    expect(nextSeen([row({ id: 'a' }), row({ id: 'b' })], null)).toEqual(['a', 'b']);
  });

  it('keeps ids that have scrolled off the inbox', () => {
    expect(nextSeen([row({ id: 'b' })], ['a'])).toEqual(['b', 'a']);
  });

  it('never records the same id twice', () => {
    expect(nextSeen([row({ id: 'a' })], ['a'])).toEqual(['a']);
  });

  it('stays bounded as ids accumulate', () => {
    const many = Array.from({ length: 300 }, (_, i) => `old-${i}`);
    expect(nextSeen([row({ id: 'new' })], many)).toHaveLength(100);
  });

  it('is empty for an empty inbox, which is not the same as never having run', () => {
    expect(nextSeen([], null)).toEqual([]);
  });
});

describe('notifyText', () => {
  it('names the task for an assignment', () => {
    const t = notifyText(row({ kind: 'assigned', task_title: 'Ship the deck', actor_name: 'Lamisa' }));
    expect(t).toEqual({ title: 'Lamisa assigned you a task', body: 'Ship the deck' });
  });

  it('names the document for a mention', () => {
    expect(notifyText(row({})).title).toBe('Shafin mentioned you in Spec');
  });

  it('falls back when the actor or document is missing', () => {
    const t = notifyText(row({ kind: 'comment', actor_name: '', doc_title: '' }));
    expect(t.title).toBe('Someone commented on Untitled');
  });
});
