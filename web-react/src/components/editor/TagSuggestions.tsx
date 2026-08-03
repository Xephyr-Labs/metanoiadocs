import { Plus } from 'lucide-react';
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
  const shown = suggested.filter((s) => !dismissed.has(s.name) && !appliedNames.has(s.name)).slice(0, 4);
  if (!shown.length) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted">Suggested:</span>
      {shown.map((s) => (
        <span key={s.name} className="group flex items-center gap-0.5 rounded-full border border-dashed border-line px-1.5 py-0.5 text-xs text-muted">
          <button className="flex items-center gap-0.5 hover:text-accent"
            onClick={() => { ws.addTagToPage(pageId, s.tagId ? { tagId: s.tagId } : { name: s.name }); dismiss(s.name); }}>
            <Plus size={11} /> {s.name}
          </button>
          <button className="opacity-0 group-hover:opacity-60 hover:!opacity-100" onClick={() => dismiss(s.name)}>×</button>
        </span>
      ))}
    </div>
  );
}
