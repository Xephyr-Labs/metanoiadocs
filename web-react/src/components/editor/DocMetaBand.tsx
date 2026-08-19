/* Hallmark · component: document metadata band · genre: modern-minimal
 * theme: project tokens (index.css) · states: default · hover (tags) ·
 * focus-visible · empty (no editor yet — renders nothing)
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Intelligence } from '../../lib/docsApi';
import { avatarFor } from '../../lib/avatar';
import { relativeTime } from '../../lib/time';
import type { Page } from '../../lib/types';
import { TagChips } from './TagChips';
import { TagSuggestions } from './TagSuggestions';

/** Reading speed for prose, the number every "N min read" uses. */
const WORDS_PER_MINUTE = 200;

function readingMinutes(root: Element | null): number {
  const text = (root as HTMLElement | null)?.innerText ?? '';
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/**
 * Who touched this page, when, and how long it takes to read — directly under
 * the title, which is where every document tool puts it.
 *
 * BlockSuite owns the title, so this cannot be rendered above the editor: it is
 * portalled into a host inserted immediately after `.doc-title-container`. That
 * is also what lets the tags sit *below* the title instead of above it, where
 * they used to be the first thing on the page.
 */
export function DocMetaBand({
  editor,
  page,
  suggested,
  savedTick,
}: {
  editor: Element | null;
  page: Page;
  suggested: Intelligence['suggestedTags'];
  savedTick: number;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [minutes, setMinutes] = useState(1);

  useEffect(() => {
    // After <doc-title> itself, not after `.doc-title-container` — the
    // container is INSIDE doc-title, and anything in that subtree is read as
    // part of the page's title.
    const title = editor?.querySelector('doc-title');
    if (!title) return;
    const el = document.createElement('div');
    el.className = 'mn-doc-meta';
    title.insertAdjacentElement('afterend', el);
    setHost(el);
    return () => { el.remove(); setHost(null); };
  }, [editor]);

  // Recount on each save, so the estimate tracks the document being written.
  useEffect(() => { setMinutes(readingMinutes(editor)); }, [editor, savedTick, page.id]);

  if (!host) return null;
  const who = page.updatedByName;
  const avatar = who ? avatarFor(who) : null;

  return createPortal(
    <div className="mb-3 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-faint">
      {avatar && who && (
        <span className="flex items-center gap-1.5">
          <span
            className="flex h-[18px] w-[18px] items-center justify-center rounded-full text-3xs font-semibold text-white"
            style={{ background: avatar.color }}
          >
            {avatar.initials}
          </span>
          <span className="text-muted">{who}</span>
        </span>
      )}
      <span>Updated {relativeTime(page.updatedAt)}</span>
      <span aria-hidden>·</span>
      <span>{minutes} min read</span>
      <TagChips page={page} trailing={<TagSuggestions pageId={page.id} suggested={suggested} />} compact />
    </div>,
    host,
  );
}
