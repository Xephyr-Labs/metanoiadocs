import { useCallback, useRef } from 'react';
import { docsApi } from '../lib/docsApi';
import type { LinkTarget } from '../editor/pageLinks';
import { useWorkspace } from '../store/workspace';

/**
 * Everything an editor needs to offer, resolve and follow "@" page links.
 *
 * These three go together and are useless apart: `mountEditor` installs the
 * link extensions only when it has both `pages` and `createPage`, and without
 * them `DocDisplayMetaProvider` is never overridden — so every reference chip
 * in the document falls back to BlockSuite's own collection, which holds one
 * doc, finds nothing, and renders the link as "Deleted page". That is exactly
 * what a task's notes did: EditorArea passed all three and the task peek
 * passed none, so the same link was a working chip on the page and a dead grey
 * label in the panel.
 *
 * `pages` is read lazily off a ref so a page created a moment ago is already
 * offerable without remounting the editor, and `createPage` goes straight to
 * the API rather than through `ws.createPage` — making a page from inside the
 * menu must not navigate away from the one being written.
 */
export function useDocLinking() {
  const ws = useWorkspace();
  const pagesRef = useRef(ws.pages);
  pagesRef.current = ws.pages;

  const pages = useCallback(
    (): LinkTarget[] => Object.values(pagesRef.current).map((p) => ({ id: p.id, title: p.title, icon: p.icon })),
    [],
  );

  const { refresh } = ws;
  const createPage = useCallback(
    async (title: string) => {
      const row = await docsApi.create({ title }).catch(() => null);
      if (row) refresh();
      return row?.id ?? null;
    },
    [refresh],
  );

  return { pages, createPage };
}
