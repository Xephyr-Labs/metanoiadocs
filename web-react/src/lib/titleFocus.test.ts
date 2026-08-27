import { describe, expect, it } from 'vitest';
import { requestTitleFocus, takeTitleFocus } from './titleFocus';

/** The handoff between the sidebar row and the editor that replaces it. It has
 *  to fire for the right document and exactly once, or an unrelated document
 *  opened later would steal the caret into its title. */
describe('title focus handoff', () => {
  it('is claimed once, by the document that asked', () => {
    requestTitleFocus('doc-a');
    expect(takeTitleFocus('doc-a')).toBe(true);
    expect(takeTitleFocus('doc-a')).toBe(false);
  });

  it('is not claimed by a different document', () => {
    requestTitleFocus('doc-a');
    expect(takeTitleFocus('doc-b')).toBe(false);
    // still waiting for the one that asked
    expect(takeTitleFocus('doc-a')).toBe(true);
  });

  it('does nothing when nobody asked', () => {
    expect(takeTitleFocus('doc-a')).toBe(false);
  });
})
