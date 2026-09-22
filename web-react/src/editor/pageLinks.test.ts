import { describe, expect, it } from 'vitest';
import { rankPages, type LinkTarget } from './pageLinks';

const page = (title: string, updatedAt?: string): LinkTarget =>
  ({ id: title, title, icon: '📄', updatedAt });

describe('rankPages', () => {
  it('puts the exact title, then the prefix, then a word start, ahead of a loose match', () => {
    const pages = [
      page('Quarterly plan archive'), // 'plan' starts a word
      page('Planning notes'), // starts with 'plan'
      page('Plan'), // exact
      page('Personal learning notes'), // subsequence only: p-l-a-n
    ];
    expect(rankPages(pages, 'plan').map((p) => p.title)).toEqual([
      'Plan',
      'Planning notes',
      'Quarterly plan archive',
      'Personal learning notes',
    ]);
  });

  it('finds the typed words in any order', () => {
    const pages = [page('Q4 roadmap'), page('Unrelated')];
    expect(rankPages(pages, 'roadmap q4').map((p) => p.title)).toEqual(['Q4 roadmap']);
  });

  it('breaks ties by recency, which sidebar order used to decide', () => {
    const pages = [
      page('Launch plan — old', '2026-01-01T00:00:00Z'),
      page('Launch plan — fresh', '2026-09-01T00:00:00Z'),
    ];
    expect(rankPages(pages, 'launch')[0].title).toBe('Launch plan — fresh');
  });

  it('drops what does not match at all, and keeps the given order for an empty query', () => {
    const pages = [page('Design principles'), page('Roadmap')];
    expect(rankPages(pages, 'zzz')).toEqual([]);
    expect(rankPages(pages, '  ')).toEqual(pages);
  });
});
