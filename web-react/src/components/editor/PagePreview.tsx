import { useEffect, useState } from 'react';

export interface PagePreviewData { docId: string; title: string; html: string }

/** Fetch the preview as soon as the page is asked for — from LazyEditor, so it
 *  does not wait for the editor's own 1.6 MB chunk to download first. Members
 *  on the live page only: a share link, a version and a draft load otherwise. */
export function usePagePreview(docId: string, skip: boolean): PagePreviewData | null {
  const [preview, setPreview] = useState<PagePreviewData | null>(null);
  useEffect(() => {
    if (skip) return;
    let live = true;
    fetch(`/api/docs/${docId}/preview`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => { if (live && p && typeof p.html === 'string') setPreview({ docId, title: String(p.title ?? ''), html: p.html }); })
      .catch(() => { /* the skeleton stays; the editor is coming either way */ });
    return () => { live = false; };
  }, [docId, skip]);
  return preview && preview.docId === docId ? preview : null;
}

/**
 * The page as plain HTML while BlockSuite starts (GET /api/docs/:id/preview).
 * A long page or a phone takes a second or more to become editable; this lets
 * it be read at once instead of behind a skeleton. Laid out on the editor's own
 * column so the swap to the real editor moves as little as possible. Not
 * interactive: it is replaced, not upgraded, when the editor is ready.
 *
 * The HTML is the server's print renderer (server/src/print.js), which escapes
 * all text and allows only http(s) and same-origin links and images.
 */
export function PagePreview({ title, html }: { title: string; html: string }) {
  return (
    <div className="mn-page-preview mx-auto w-full max-w-[712px] px-6 pt-4 md:px-0" aria-busy="true">
      <h1 className="mn-page-preview-title">{title || 'Untitled'}</h1>
      <div className="mn-page-preview-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
