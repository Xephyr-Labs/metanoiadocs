import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useWorkspace } from '../../store/workspace';
import type { Intelligence } from '../../lib/docsApi';

const dismissKey = (pageId: string) => `mn-tagsug-dismiss-${pageId}`;

export function TagSuggestions({ pageId, suggested }: { pageId: string; suggested: Intelligence['suggestedTags'] }) {
  const ws = useWorkspace();
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(dismissKey(pageId)) || '[]')); }
    catch { return new Set(); }
  });
  const dismiss = (name: string) => {
    const next = new Set(dismissed).add(name);
    setDismissed(next);
    localStorage.setItem(dismissKey(pageId), JSON.stringify([...next]));
  };
  const appliedNames = new Set((ws.currentPage?.tags ?? []).map((t) => t.name));
  // Three, on the same line as the real tags. This used to be its own labelled
  // row under them, which put a permanent second strip of chrome above every
  // page title to offer something nobody asked for. The dashed outline already
  // reads as "not applied yet"; the "Suggested:" label was doing no work.
  // Only tags the workspace already has. The server also offers keyphrases as
  // new tags, and those read as word salad ("paths timeline open questions")
  // in the most prominent spot on the page, right under the title.
  const shown = suggested
    .filter((s) => s.exists && !dismissed.has(s.name) && !appliedNames.has(s.name))
    .slice(0, 3);
  if (!shown.length) return null;
  return (
    <>
      {shown.map((s) => (
        <span key={s.name} className="group flex items-center gap-0.5 rounded-full border border-dashed border-line px-1.5 py-0.5 text-xs text-muted">
          <button type="button" className="mn-hit flex items-center gap-0.5 hover:text-accent-strong"
            onClick={() => { ws.addTagToPage(pageId, s.tagId ? { tagId: s.tagId } : { name: s.name }); dismiss(s.name); }}>
            <Plus size={12} /> {s.name}
          </button>
          <button
            type="button"
            aria-label={`Don't suggest ${s.name}`}
            className="mn-hit opacity-0 focus-visible:opacity-100 group-hover:opacity-60 hover:!opacity-100 [@media(hover:none)]:opacity-60"
            onClick={() => dismiss(s.name)}
          >
            <X size={12} />
          </button>
        </span>
      ))}
    </>
  );
}
