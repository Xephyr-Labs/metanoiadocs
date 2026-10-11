import { describe, expect, it } from 'vitest';
import { APP_PATHS, dbPath, parseRoute } from './route';

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
    expect(answers('/db/project-4')).toBe(true);
    expect(answers('/db/project-4/view-2')).toBe(true);
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

describe('the database address', () => {
  it('names the database, and the view when there is one', () => {
    expect(parseRoute('/db/p1').projectId).toBe('p1');
    expect(parseRoute('/db/p1').viewId).toBe(null);
    expect(parseRoute('/db/p1/v9').viewId).toBe('v9');
  });

  it('does not mistake a document for a database', () => {
    // /d/ and /db/ differ by one character, and both are two segments long.
    expect(parseRoute('/d/abc').projectId).toBe(null);
    expect(parseRoute('/db/abc').docId).toBe(null);
  });

  it('round-trips an id that needs escaping', () => {
    const path = dbPath('a/b', 'c d');
    expect(path).toBe('/db/a%2Fb/c%20d');
    expect(parseRoute(path).projectId).toBe('a/b');
    expect(parseRoute(path).viewId).toBe('c d');
  });

  it('names the task a notification link points at, only on a database', () => {
    expect(parseRoute('/db/p1', '', '?task=t-9').taskId).toBe('t-9');
    expect(parseRoute('/db/p1').taskId).toBe(null);
    expect(parseRoute('/d/abc', '', '?task=t-9').taskId).toBe(null);
    expect(APP_PATHS.some((re) => re.test('/db/p1?task=t-9'))).toBe(true);
  });

  it('still reads a block fragment on a document', () => {
    expect(parseRoute('/d/abc', '#block-7').blockId).toBe('block-7');
  });
});

describe('links copied in AFFiNE', () => {
  const affine = '/workspace/39226e31-533f-4ec2-813c-45f722cd31d4/74g-D-KA6Rw0ovnQvNAmr';

  it('open the page they name, at the block they name', () => {
    const r = parseRoute(affine, '', '?mode=page&blockIds=sYrowQxAX_');
    expect(r.docId).toBe('74g-D-KA6Rw0ovnQvNAmr');
    expect(r.blockId).toBe('sYrowQxAX_');
  });

  it('open the page when no block is named', () => {
    const r = parseRoute(affine, '', '?mode=page');
    expect(r.docId).toBe('74g-D-KA6Rw0ovnQvNAmr');
    expect(r.blockId).toBe(null);
  });

  it('are served the app shell', () => {
    expect(answers(affine)).toBe(true);
    expect(answers('/workspace')).toBe(false);
  });

  it('are not read as pages when they are AFFiNE\'s own screens', () => {
    for (const screen of ['all', 'collection/c1', 'tag/t1', 'trash', 'journals']) {
      expect(parseRoute(`/workspace/ws/${screen}`).docId).toBe(null);
    }
  });

  it('do not change what a query means on our own addresses', () => {
    expect(parseRoute('/d/abc', '', '?blockIds=x').blockId).toBe(null);
  });
});
