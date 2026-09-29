import { describe, expect, it } from 'vitest';
import { diffText } from './androidRecompose';

describe('diffText', () => {
  it('turns a backspaced reopened word into a deletion', () => {
    expect(diffText('hello world', 'hel world', 3)).toEqual({ index: 3, length: 2, text: '' });
  });
  it('replaces an autocorrected word', () => {
    expect(diffText('teh cat', 'the cat', 3)).toEqual({ index: 1, length: 2, text: 'he' });
  });
  it('is empty when the keyboard only picked a word up', () => {
    expect(diffText('The onboarding flow', 'The onboarding flow', 14)).toMatchObject({ length: 0, text: '' });
  });
  it('puts a repeated letter at the caret', () => {
    expect(diffText('hello', 'helllo', 4)).toEqual({ index: 3, length: 0, text: 'l' });
    expect(diffText('hello', 'hello', 2)).toMatchObject({ length: 0, text: '' });
  });
  it('inserts new text at the end', () => {
    expect(diffText('hello ', 'hello wor', 9)).toEqual({ index: 6, length: 0, text: 'wor' });
  });
  it('works without a caret', () => {
    expect(diffText('hello world', ' world', null)).toEqual({ index: 0, length: 5, text: '' });
  });
});
