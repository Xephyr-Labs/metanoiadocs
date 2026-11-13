import { describe, expect, it } from 'vitest';
import { contextualPrompt, CONTEXTUAL_ACTIONS } from './contextualAi';
describe('contextual AI proposals', () => {
  it('keeps every selected-text action scoped and reviewable', () => {
    expect(CONTEXTUAL_ACTIONS.map(a => a.id)).toEqual(['clarify', 'shorten', 'decisions', 'tasks']);
    for (const action of CONTEXTUAL_ACTIONS) {
      const prompt = contextualPrompt(action.id);
      expect(prompt).toContain('selected text');
      expect(prompt).toContain('review');
      expect(prompt).toContain('source');
    }
    expect(contextualPrompt('tasks')).toContain('Do not create');
  });
});
