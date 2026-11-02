import { describe, expect, it, vi } from 'vitest';
import { docsApi, type SuggestionDraft } from './docsApi';
import { currentMode, pickDrafts, setMode } from './reviewMode';

vi.mock('./docsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./docsApi')>()),
  docsApi: { startSuggesting: vi.fn(async () => { throw new Error('no drafts any more'); }), suggestions: vi.fn(async () => []) },
}));

const d = (over: Partial<SuggestionDraft>): SuggestionDraft => ({
  id: 'x', docId: 'd1', authorId: 'me', authorName: 'Me', status: 'submitted', message: null,
  createdAt: '', updatedAt: '', submittedAt: null, draft: 'd1~x', writerVia: null, approverId: null, ...over,
});

describe('pickDrafts', () => {
  it('an Ask AI draft is not my Suggesting draft, and comes to me to review', () => {
    const ai = d({ id: 'ai', writerVia: 'ai', approverId: 'me' });
    const mine = d({ id: 'mine', status: 'draft' });
    expect(pickDrafts([ai], 'me', 'editor')).toEqual({ myDraft: null, toReview: [ai] });
    expect(pickDrafts([ai, mine], 'me', 'editor')).toEqual({ myDraft: mine, toReview: [ai] });
  });

  it('an agent draft goes only to its approver, whatever their role', () => {
    const agent = d({ id: 'ag', authorId: 'andy', writerVia: 'agent', approverId: 'me' });
    expect(pickDrafts([agent], 'me', 'editor').toReview).toEqual([agent]);
    expect(pickDrafts([agent], 'other', 'owner').toReview).toEqual([]);
    expect(pickDrafts([d({ id: 'orph', authorId: 'andy', writerVia: 'agent', approverId: null })], 'me', 'owner').toReview).toEqual([]);
  });

  it("another person's submitted draft is reviewable by an editor only; unsubmitted never", () => {
    const theirs = d({ id: 't', authorId: 'them' });
    expect(pickDrafts([theirs], 'me', 'editor').toReview).toEqual([theirs]);
    expect(pickDrafts([theirs], 'me', 'suggester').toReview).toEqual([]);
    expect(pickDrafts([d({ authorId: 'them', status: 'draft' })], 'me', 'editor').toReview).toEqual([]);
  });
});

describe('Suggesting mode is local state', () => {
  it('turning it on starts no draft', async () => {
    await setMode('d1', 'suggesting');
    expect(docsApi.startSuggesting).not.toHaveBeenCalled();
    expect(currentMode('d1', 'editor')).toBe('suggesting');
  });

  it('a suggester opens in it with no draft, and a viewer cannot pick it', async () => {
    expect(currentMode('d2', 'suggester')).toBe('suggesting');
    await setMode('d3', 'suggesting');
    expect(currentMode('d3', 'viewer')).toBe('viewing');
  });
});
