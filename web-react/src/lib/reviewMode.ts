// Editing / Suggesting / Viewing, per page, and which draft is under review.
//
// Kept outside the workspace store on purpose: the top bar sets the mode, the
// editor area renders it, and the comments panel lists the drafts — three
// places that share nothing else, and a context provider for one enum would
// re-render the whole workspace on every switch.
import { useCallback, useEffect, useState } from 'react';
import { canCommentRole, canEditRole, canSuggestRole, docsApi, type SuggestionDraft } from './docsApi';
import { toast } from './toast';

export type EditMode = 'editing' | 'suggesting' | 'viewing';

interface State {
  /** Chosen mode per page. Absent: the role's default. */
  modes: Map<string, EditMode>;
  /** Open drafts per page (yours, and submitted ones you can review). */
  drafts: Map<string, SuggestionDraft[]>;
  /** The draft whose review is open, and the page it belongs to. */
  reviewing: { sid: string; docId: string } | null;
}

const state: State = { modes: new Map(), drafts: new Map(), reviewing: null };
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

/** What a role opens a page in when nobody has chosen. */
export const defaultMode = (role?: string | null): EditMode =>
  canEditRole(role) ? 'editing' : canSuggestRole(role) ? 'suggesting' : 'viewing';

/** The modes a role may pick from. */
export const modesFor = (role?: string | null): EditMode[] =>
  canEditRole(role) ? ['editing', 'suggesting', 'viewing'] : canSuggestRole(role) ? ['suggesting', 'viewing'] : ['viewing'];

export async function loadDrafts(docId: string) {
  try {
    state.drafts.set(docId, await docsApi.suggestions(docId));
    changed();
  } catch { /* the list stays as it was; the next open retries */ }
}

export function openReview(sid: string, docId: string) { state.reviewing = { sid, docId }; changed(); }
export function closeReview() { state.reviewing = null; changed(); }

export async function setMode(docId: string, mode: EditMode) {
  if (mode === 'suggesting') {
    // The draft has to exist before the editor can connect to it.
    try {
      const d = await docsApi.startSuggesting(docId);
      const rest = (state.drafts.get(docId) ?? []).filter((x) => x.id !== d.id);
      state.drafts.set(docId, [d, ...rest]);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not start suggesting');
      return;
    }
  }
  state.modes.set(docId, mode);
  changed();
}

/** After a draft is discarded or fully reviewed: drop it and leave Suggesting. */
export function forgetDraft(docId: string, sid: string) {
  state.drafts.set(docId, (state.drafts.get(docId) ?? []).filter((d) => d.id !== sid));
  if (state.reviewing?.sid === sid) state.reviewing = null;
  if (state.modes.get(docId) === 'suggesting') state.modes.delete(docId);
  changed();
}

export function useReviewState(docId: string | null | undefined, role: string | null | undefined, userId?: string | null) {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  useEffect(() => { if (docId) void loadDrafts(docId); }, [docId]);

  const allowed = modesFor(role);
  const chosen = docId ? state.modes.get(docId) : undefined;
  let mode = chosen && allowed.includes(chosen) ? chosen : defaultMode(role);
  const drafts = (docId && state.drafts.get(docId)) || [];
  const myDraft = drafts.find((d) => d.authorId === userId) ?? null;
  // Suggesting needs the draft; until it is made (a suggester's first open),
  // the page shows read-only rather than editable-but-unsaved.
  if (mode === 'suggesting' && !myDraft) mode = 'viewing';
  const toReview = canEditRole(role) ? drafts.filter((d) => d.status === 'submitted' && d.authorId !== userId) : [];

  // A suggester opening a page lands in Suggesting: make their draft.
  const needsDraft = !!docId && !chosen && defaultMode(role) === 'suggesting' && !myDraft;
  useEffect(() => {
    if (needsDraft && docId) void setMode(docId, 'suggesting');
  }, [needsDraft, docId]);

  return {
    mode,
    allowed,
    myDraft,
    toReview,
    // Only on the page it belongs to: opening another page leaves the review.
    reviewing: state.reviewing && state.reviewing.docId === docId ? state.reviewing.sid : null,
    /** The role the editor should open with in this mode. */
    effectiveRole: mode === 'viewing' ? (canCommentRole(role) ? 'commenter' : 'viewer') : role ?? undefined,
    setMode: useCallback((m: EditMode) => { if (docId) void setMode(docId, m); }, [docId]),
  };
}
