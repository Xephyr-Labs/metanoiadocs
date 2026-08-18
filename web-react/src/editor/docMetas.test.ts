import { describe, expect, it } from 'vitest';
import { missingDocMetas } from './docMetas';

const NOW = 1_700_000_000_000;

describe('missingDocMetas', () => {
  it('registers a page the collection has never heard of', () => {
    expect(missingDocMetas([{ id: 'a' }], [{ id: 'b', title: 'Notes', icon: '📄' }], NOW)).toEqual([
      { id: 'b', title: 'Notes', tags: [], createDate: NOW },
    ]);
  });

  it('skips pages the collection already knows', () => {
    expect(missingDocMetas([{ id: 'a' }], [{ id: 'a', title: 'Notes', icon: '📄' }], NOW)).toEqual([]);
  });

  it('registers a repeated id only once', () => {
    const targets = [
      { id: 'b', title: 'Notes', icon: '📄' },
      { id: 'b', title: 'Notes', icon: '📄' },
    ];
    expect(missingDocMetas([], targets, NOW)).toHaveLength(1);
  });

  it('falls back to Untitled so a nameless page is still not "deleted"', () => {
    expect(missingDocMetas([], [{ id: 'b', title: '', icon: '' }], NOW)[0].title).toBe('Untitled');
  });
});
