import { describe, expect, it, vi } from 'vitest';
import { canEditRole, docsApi, opensWritable, type SuggestionDraft } from './docsApi';
import { canDecideSuggestions, currentMode, loadDrafts, pickDrafts, resolveReview, setMode } from './reviewMode';

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

describe('what the page shows (useReviewState)', () => {
  it('an owner who picks Suggesting with no draft is in Suggesting, on a writable editor', async () => {
    await setMode('d4', 'suggesting');
    const r = resolveReview('d4', 'owner', 'me');
    expect(r.mode).toBe('suggesting');
    expect(r.myDraft).toBeNull();
    // mountEditor opens the page writable for this role, and attaches suggestingInput (it skips only read-only editors).
    expect(canEditRole(r.effectiveRole)).toBe(true);
  });

  it('a suggester opens Suggesting on a writable editor, and never gets Editing', async () => {
    const r = resolveReview('d6', 'suggester', 'me');
    expect(r.mode).toBe('suggesting');
    expect(r.allowed).not.toContain('editing');
    // mountEditor opens the page writable for this role and attaches suggestingInput.
    expect(opensWritable(r.effectiveRole)).toBe(true);
    await setMode('d6', 'editing');
    expect(currentMode('d6', 'suggester')).toBe('suggesting');
    await setMode('d6', 'viewing');
    expect(opensWritable(resolveReview('d6', 'suggester', 'me').effectiveRole)).toBe(false);
    for (const role of ['commenter', 'viewer']) expect(opensWritable(resolveReview('d7', role, 'me').effectiveRole)).toBe(false);
    for (const role of ['owner', 'editor']) expect(opensWritable(role)).toBe(true);
  });

  it('a legacy draft of mine is still the one Suggesting opens', async () => {
    vi.mocked(docsApi.suggestions).mockResolvedValueOnce([d({ id: 'old', docId: 'd5', status: 'draft' })]);
    await loadDrafts('d5');
    await setMode('d5', 'suggesting');
    expect(resolveReview('d5', 'editor', 'me').myDraft?.id).toBe('old');
  });
});

describe('who sees Accept and Reject (canDecideSuggestions)', () => {
  it('an editor in Editing or Suggesting decides; the same editor in Viewing does not', async () => {
    for (const role of ['owner', 'editor']) {
      await setMode('d8', 'editing');
      expect(canDecideSuggestions(resolveReview('d8', role, 'me').effectiveRole, 'person')).toBe(true);
      await setMode('d8', 'suggesting');
      expect(canDecideSuggestions(resolveReview('d8', role, 'me').effectiveRole, 'person')).toBe(true);
      await setMode('d8', 'viewing');
      expect(canDecideSuggestions(resolveReview('d8', role, 'me').effectiveRole, 'person')).toBe(false);
    }
  });

  it('a suggester, commenter or viewer never decides', () => {
    for (const role of ['suggester', 'commenter', 'viewer']) expect(canDecideSuggestions(resolveReview('d9', role, 'me').effectiveRole, 'person')).toBe(false);
  });

  it('an agent account never decides, even as an editor', () => {
    expect(canDecideSuggestions('editor', 'agent')).toBe(false);
    expect(canDecideSuggestions('owner', 'agent')).toBe(false);
    expect(canDecideSuggestions('editor', undefined)).toBe(true);
  });
});
