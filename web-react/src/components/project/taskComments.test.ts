import { describe, expect, it } from 'vitest';
import { applyMention, mentionQuery, threadComments } from './TaskComments';

// The menu appearing when nobody asked for it is the failure mode of every
// @-picker: it steals Enter, and Enter is how a comment is sent.
describe('mentionQuery', () => {
  it('is null until an @ is typed', () => {
    expect(mentionQuery('')).toBeNull();
    expect(mentionQuery('looks done to me')).toBeNull();
  });

  it('opens on a bare @ so the whole team is offered', () => {
    expect(mentionQuery('@')).toBe('');
    expect(mentionQuery('ready for @')).toBe('');
  });

  it('matches on what has been typed so far, lowercased', () => {
    expect(mentionQuery('ping @Ada')).toBe('ada');
  });

  it('closes once the handle is finished, so Enter sends the comment', () => {
    expect(mentionQuery('@ada please look')).toBeNull();
  });

  it('ignores the @ inside an email address', () => {
    expect(mentionQuery('mail ada@example.com')).toBeNull();
  });

  it('reads the last handle, not the first', () => {
    expect(mentionQuery('@ada and @ri')).toBe('ri');
  });
});

describe('applyMention', () => {
  it('completes the handle and leaves a space to carry on typing', () => {
    expect(applyMention('ping @ad', 'ada')).toBe('ping @ada ');
  });

  it('keeps everything written before it', () => {
    expect(applyMention('blocked on this, @', 'rima')).toBe('blocked on this, @rima ');
  });
});

describe('threadComments', () => {
  const c = (id: string, parent_id: string | null = null) => ({ id, parent_id });

  it('keeps top-level comments in order, each with its replies', () => {
    const out = threadComments([c('a'), c('b'), c('a1', 'a'), c('b1', 'b'), c('a2', 'a')]);
    expect(out.map((t) => [t.root.id, t.replies.map((r) => r.id)])).toEqual([
      ['a', ['a1', 'a2']],
      ['b', ['b1']],
    ]);
  });

  it('files a reply to a reply under the same top-level comment', () => {
    const out = threadComments([c('a'), c('a1', 'a'), c('a1x', 'a1')]);
    expect(out).toHaveLength(1);
    expect(out[0].replies.map((r) => r.id)).toEqual(['a1', 'a1x']);
  });

  it('lets a reply whose parent is gone stand on its own', () => {
    const out = threadComments([c('x', 'missing')]);
    expect(out.map((t) => t.root.id)).toEqual(['x']);
  });
});
