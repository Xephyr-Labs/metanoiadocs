import { describe, expect, it } from 'vitest';
import { normalizeFolderRows, type FolderRow } from './docsApi';

describe('normalizeFolderRows', () => {
  it('treats a legacy HTML fallback as an empty folder list', () => {
    expect(normalizeFolderRows('<!doctype html><html></html>')).toEqual([]);
  });

  it('keeps a valid folder payload', () => {
    const folders: FolderRow[] = [{
      id: 'f1', name: 'Docs', parent_id: null, position: 0,
      created_by: 'u1', created_at: '2026-08-04T00:00:00Z', document_count: 1, folder_count: 0,
    }];
    expect(normalizeFolderRows(folders)).toEqual(folders);
  });
});
