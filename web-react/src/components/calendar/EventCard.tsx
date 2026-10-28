/* Hallmark · redesign inside Workbench (app chrome) · project tokens preserved
 * states: buttons default · hover · focus-visible · active · disabled · loading ("Saving…") · error (inline line) · success (answer pressed) */
import { useEffect, useState } from 'react';
import { Check, CircleHelp, Clock, ExternalLink, MapPin, Repeat, Video, X } from 'lucide-react';
import {
  CalendarWriteError, canAnswer, cancelMeeting, cancelPrompt, linkParts, meetingTime, respondToMeeting, safeMeetLink, startNotes,
  type CalendarEvent, type CalendarResponse,
} from '../../lib/calendarEvents';
import { wantSettingsSection } from '../../lib/calendar';
import { cn } from '../../lib/cn';
import { useWorkspace } from '../../store/workspace';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

const ANSWERS: { value: 'accepted' | 'tentative' | 'declined'; label: string }[] = [
  { value: 'accepted', label: 'Accept' },
  { value: 'tentative', label: 'Maybe' },
  { value: 'declined', label: 'Decline' },
];

function ResponseMark({ response }: { response: CalendarResponse | null }) {
  if (response === 'accepted') return <Check size={14} className="text-ok" role="img" aria-label="Going" />;
  if (response === 'declined') return <X size={14} className="text-danger-strong" role="img" aria-label="Not going" />;
  if (response === 'tentative') return <CircleHelp size={14} className="text-muted" role="img" aria-label="Maybe" />;
  return <span className="text-3xs text-faint">No answer</span>;
}

/** "Tuesday, October 27 · 10:00 – 10:30 AM" in the person's zone; all-day spans by date. */
function whenLine(e: CalendarEvent, zone: string): string {
  if (!e.start) return '';
  if (e.allDay) {
    const d = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
    const lastMs = e.end ? Date.parse(`${e.end.slice(0, 10)}T00:00:00Z`) - 86_400_000 : 0;
    const last = lastMs ? new Date(lastMs).toISOString().slice(0, 10) : null;
    return last && last > e.start.slice(0, 10) ? `${d(e.start)} – ${d(last)}` : `${d(e.start)} · All day`;
  }
  const day = new Date(e.start).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: zone });
  return `${day} · ${meetingTime(e, undefined, zone)}`;
}

interface Props {
  event: CalendarEvent | null;
  zone: string;
  canWrite: boolean;
  /** Teammates' names by user id, for attendees Google only knows by email. */
  names: Map<string, string>;
  onClose: () => void;
  /** Read the calendar again after a write; resolves once the page has the new answer. */
  onChanged: () => Promise<void>;
  onEdit: (e: CalendarEvent) => void;
}

/** A meeting's details and what you can do with it: card on desktop, bottom sheet on a phone. */
export function EventCard({ event, zone, canWrite, names, onClose, onChanged, onEdit }: Props) {
  const ws = useWorkspace();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsWrite, setNeedsWrite] = useState(false);
  useEffect(() => { setError(null); setNeedsWrite(false); setBusy(null); }, [event?.id]);

  const e = event;
  const reconnect = () => { wantSettingsSection('mycalendar'); ws.setSettingsOpen(true); };
  const run = async (key: string, fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await onChanged();
      after?.();
    } catch (err) {
      if (err instanceof CalendarWriteError && (err.needsWrite || err.reconnect)) {
        setNeedsWrite(true);
        void onChanged(); // the page's bar and New meeting learn it too
      }
      else setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const notes = async () => {
    if (!e) return;
    if (e.notesDocId) { ws.select(e.notesDocId); onClose(); return; }
    setBusy('notes');
    setError(null);
    try {
      const { docId } = await startNotes(e.id, ws.currentSpaceId || undefined);
      ws.select(docId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start notes.');
    } finally {
      setBusy(null);
    }
  };

  const link = e ? safeMeetLink(e.meetLink) : null;
  const google = e ? safeMeetLink(e.htmlLink) : null;
  const answerable = !!e && canAnswer(e);
  const writeControls = !!e && (answerable || e.organizerSelf);
  const showWrite = canWrite && !needsWrite;

  return (
    <Modal
      open={!!e}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={<span className={cn('truncate', e?.myResponse === 'declined' && 'line-through decoration-faint')}>{e?.title || 'Untitled meeting'}</span>}
      width={440}
      className="max-h-[min(88dvh,640px)]"
    >
      {e && (
        <>
          <div className="scrollarea min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 text-sm">
            <div className="space-y-1.5">
              <p className="flex items-start gap-2 text-ink">
                <Clock size={16} className="mt-0.5 shrink-0 text-faint" aria-hidden />
                <span>{whenLine(e, zone)}</span>
              </p>
              {e.recurringEventId && (
                <p className="flex items-start gap-2 text-muted">
                  <Repeat size={16} className="mt-0.5 shrink-0 text-faint" aria-hidden />
                  <span>Repeats — changes here apply to this one only</span>
                </p>
              )}
              {e.location && (
                <p className="flex items-start gap-2 text-ink">
                  <MapPin size={16} className="mt-0.5 shrink-0 text-faint" aria-hidden />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{e.location}</span>
                </p>
              )}
            </div>

            {(link || google) && (
              <div className="flex flex-wrap items-center gap-2">
                {link && (
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mn-hit inline-flex h-8 items-center gap-1.5 rounded-md bg-accent-fill px-3 text-base font-medium text-white transition-colors duration-120 hover:bg-accent-fill-hover active:bg-accent-fill-active"
                  >
                    <Video size={16} aria-hidden /> Join meeting
                  </a>
                )}
                {google && (
                  <a
                    href={google}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded text-xs text-muted transition-colors duration-120 hover:text-ink hover:underline"
                  >
                    Open in Google Calendar <ExternalLink size={12} aria-hidden />
                  </a>
                )}
              </div>
            )}

            {e.description && (
              <p className="whitespace-pre-line text-ink [overflow-wrap:anywhere]">
                {linkParts(e.description).map((p, i) => (p.href ? (
                  <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" className="text-accent-strong hover:underline">{p.text}</a>
                ) : <span key={i}>{p.text}</span>))}
              </p>
            )}

            {e.attendees.length > 0 && (
              <section aria-label="Guests">
                <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">
                  {e.attendees.length} {e.attendees.length === 1 ? 'guest' : 'guests'}
                </h3>
                <ul className="space-y-1.5">
                  {e.attendees.map((a) => {
                    const name = (a.userId && names.get(a.userId)) || a.name || a.email;
                    return (
                      <li key={a.email || name} className="flex items-center gap-2">
                        <Avatar name={name} size={22} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-ink">
                            {name}{a.self && <span className="text-faint"> (you)</span>}
                          </span>
                          {name !== a.email && a.email && <span className="block truncate text-2xs text-faint">{a.email}</span>}
                        </span>
                        <ResponseMark response={a.response} />
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>

          <div className="shrink-0 space-y-2.5 border-t border-line px-4 py-3">
            {error && <p role="alert" className="text-xs text-danger-strong">{error}</p>}
            {writeControls && !showWrite && (
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 basis-48 text-xs text-muted">Reconnect your calendar to send and answer invites</p>
                <Button size="sm" onClick={reconnect}>Reconnect</Button>
              </div>
            )}
            {answerable && showWrite && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted">Going?</span>
                <div role="group" aria-label="Your answer" className="inline-flex rounded-md ring-1 ring-inset ring-line-strong">
                  {ANSWERS.map((a, i) => {
                    const on = e.myResponse === a.value;
                    return (
                      <button
                        key={a.value}
                        type="button"
                        aria-pressed={on}
                        disabled={busy !== null}
                        onClick={() => { if (!on) void run(a.value, () => respondToMeeting(e.id, a.value)); }}
                        className={cn(
                          'mn-hit h-7 px-2.5 text-sm font-medium transition-colors duration-120 disabled:opacity-50',
                          i === 0 && 'rounded-l-md', i === ANSWERS.length - 1 && 'rounded-r-md', i > 0 && 'border-l border-line-strong',
                          on ? 'relative z-10 bg-accent-soft font-semibold text-accent-strong ring-1 ring-inset ring-accent' : 'text-muted hover:bg-hover hover:text-ink active:bg-selected',
                        )}
                      >
                        {busy === a.value ? 'Saving…' : a.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={busy !== null} onClick={notes}>
                {busy === 'notes' ? 'Starting…' : e.notesDocId ? 'Open notes' : 'Start notes'}
              </Button>
              {e.organizerSelf && showWrite && (
                <>
                  <Button size="sm" disabled={busy !== null} onClick={() => onEdit(e)}>Edit</Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto text-danger-strong hover:bg-danger-soft hover:text-danger-strong"
                    disabled={busy !== null}
                    onClick={() => {
                      if (window.confirm(cancelPrompt(e))) void run('cancel', () => cancelMeeting(e.id), onClose);
                    }}
                  >
                    {busy === 'cancel' ? 'Cancelling…' : 'Cancel meeting'}
                  </Button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
