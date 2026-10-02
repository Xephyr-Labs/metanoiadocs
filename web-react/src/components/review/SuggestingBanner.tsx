import { useState } from 'react';
import { Send, SquarePen, Trash2 } from 'lucide-react';
import { docsApi, type SuggestionDraft } from '../../lib/docsApi';
import { forgetDraft, loadDrafts, setMode } from '../../lib/reviewMode';
import { toast } from '../../lib/toast';
import { Button } from '../ui/Button';

/**
 * The strip over the editor in Suggesting mode. It says, in one line, that
 * what is being typed is a draft and not the page, and holds the two things a
 * suggester does with one: hand it over for review, or throw it away.
 */
export function SuggestingBanner({ draft, canEdit }: { draft: SuggestionDraft; canEdit: boolean }) {
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState(draft.message ?? '');
  const [busy, setBusy] = useState(false);
  const submitted = draft.status === 'submitted';

  const submit = async () => {
    setBusy(true);
    try {
      await docsApi.submitSuggestion(draft.id, message.trim() || undefined);
      toast(submitted ? 'Review request updated' : 'Sent for review — the page\'s editors have been told');
      setAsking(false);
      await loadDrafts(draft.docId);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not send for review');
    } finally { setBusy(false); }
  };

  const discard = async () => {
    if (!confirm('Discard your suggested changes? This cannot be undone.')) return;
    setBusy(true);
    try {
      await docsApi.discardSuggestion(draft.id);
      forgetDraft(draft.docId, draft.id);
      toast('Suggestions discarded');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not discard');
    } finally { setBusy(false); }
  };

  return (
    <div className="shrink-0 border-b border-line bg-accent-soft px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <SquarePen size={15} className="shrink-0 text-accent-strong" />
        <p className="min-w-0 flex-1 text-ink">
          <span className="font-medium">Suggesting.</span>{' '}
          <span className="text-muted">
            {submitted
              ? 'Sent for review. Keep editing — reviewers see your latest changes.'
              : 'Your edits are a private draft. The page changes only when someone who can edit it accepts them.'}
          </span>
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          {canEdit && (
            <Button variant="ghost" size="sm" onClick={() => void setMode(draft.docId, 'editing')}>
              Back to editing
            </Button>
          )}
          <Button variant="ghost" size="sm" leftIcon={<Trash2 size={14} />} onClick={discard} disabled={busy}>
            Discard
          </Button>
          <Button variant="primary" size="sm" leftIcon={<Send size={14} />} onClick={() => setAsking((v) => !v)} disabled={busy}>
            {submitted ? 'Update request' : 'Send for review'}
          </Button>
        </div>
      </div>
      {asking && (
        <div className="mt-2 flex items-center gap-2">
          <input
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); if (e.key === 'Escape') setAsking(false); }}
            placeholder="Add a note for the reviewer (optional)"
            className="h-8 min-w-0 flex-1 rounded-md bg-canvas px-2.5 text-sm outline-none ring-1 ring-inset ring-line focus:ring-2 focus:ring-accent"
          />
          <Button variant="primary" size="sm" onClick={submit} disabled={busy}>Send</Button>
        </div>
      )}
    </div>
  );
}
