import { describe, expect, it } from 'vitest';
import { applyMention, mentionQuery } from './TaskComments';

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
