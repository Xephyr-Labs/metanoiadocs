export const CONTEXTUAL_ACTIONS = [
  { id: 'clarify', label: 'Clarify' },
  { id: 'shorten', label: 'Shorten' },
  { id: 'decisions', label: 'Extract decisions' },
  { id: 'tasks', label: 'Propose tasks' },
] as const;
export type ContextualAction = typeof CONTEXTUAL_ACTIONS[number]['id'];
export function contextualPrompt(action: ContextualAction): string {
  const instruction = {
    clarify: 'Propose a clearer version of the selected text using edit_doc, preserving meaning and voice. Make only this passage a suggestion for review.',
    shorten: 'Propose a shorter version of the selected text using edit_doc, preserving meaning. Make only this passage a suggestion for review.',
    decisions: 'Extract only explicit decisions from the selected text for review. Separate decisions from open questions. Do not edit the page.',
    tasks: 'Propose tasks from the selected text for review, with supporting quotes. Include owners and dates only when explicitly stated. Do not create tasks or edit the page.',
  }[action];
  return `${instruction} Cite the source page beside each proposal and quote the supporting source text. If the selection is ambiguous or stale, ask before changing it.`;
}
export interface ContextualRequest { action: ContextualAction; selection: string; docId: string; title: string }
let pending: ContextualRequest | null = null;
export function requestContextualAi(request: ContextualRequest) {
  pending = request;
  window.dispatchEvent(new Event('mn-contextual-ai'));
}
export function takeContextualAi() { const request = pending; pending = null; return request; }
