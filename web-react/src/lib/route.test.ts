import { describe, expect, it } from 'vitest';
import { APP_PATHS } from './route';

const answers = (path: string) => APP_PATHS.some((re) => re.test(path));

/** APP_PATHS is what the service worker's navigation fallback covers. Too wide and
 *  the app shell is served in place of the other apps on this origin; too narrow
 *  and a deep link to a document reloads into nothing. */
describe('APP_PATHS', () => {
  it('covers the addresses the app itself answers', () => {
    expect(answers('/')).toBe(true);
    expect(answers('/d/abc-123')).toBe(true);
    expect(answers('/d/abc-123#block-7')).toBe(true);
    expect(answers('/f/folder-9')).toBe(true);
  });

  it('leaves the rest of the origin to the network', () => {
    // Sibling apps Caddy routes elsewhere — the bug that prompted the allowlist.
    expect(answers('/bexpharma/bexpharma-kpi-report.html')).toBe(false);
    expect(answers('/taskgantt/')).toBe(false);
    expect(answers('/jira/')).toBe(false);
    // Server-side concerns.
    expect(answers('/api/docs')).toBe(false);
    expect(answers('/sync')).toBe(false);
    expect(answers('/share/token-1')).toBe(false);
    expect(answers('/health')).toBe(false);
  });
});
