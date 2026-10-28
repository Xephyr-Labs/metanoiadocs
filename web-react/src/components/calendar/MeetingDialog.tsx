/* Hallmark · redesign inside Workbench (app chrome) · project tokens preserved · pre-emit critique: P4 H4 E4 S4 R5 V3
 * states: fields default · hover (ring-line-strong) · focus (accent ring) · error (danger ring + line under the field) · disabled (while saving);
 * Save default · hover · focus-visible · active · disabled · loading ("Saving…") · success (toast, dialog closes) · error (alert line / Reconnect line) */
import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import {
  CalendarWriteError, createMeeting, isEmail, meetingForm, meetingRequest, newMeetingForm, updateMeeting,
  type MeetingBody, type MeetingErrors, type MeetingForm,
} from '../../lib/calendarEvents';
import { wantSettingsSection } from '../../lib/calendar';
import { cn } from '../../lib/cn';
import type { UserRow } from '../../lib/docsApi';
import { toast } from '../../lib/toast';
import { useWorkspace } from '../../store/workspace';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Switch } from '../ui/Switch';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { addDays, daysBetween } from '../../lib/gantt';
import { field } from '../ui/styles';
import type { EditorTarget } from './CalendarPage';

interface Props {
  /** null = closed. */
  target: EditorTarget | null;
  zone: string;
  /** Everyone in the workspace; agents and you are left out of the picker. */
  users: UserRow[];
  meId?: string;
  onClose: () => void;
  /** Read the calendar again after a write. */
  onSaved: () => Promise<void>;
}

const input = cn(field, 'hover:ring-line-strong aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-danger');

function Field({ label, error, id, children, className }: { label: string; error?: string; id: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted">{label}</label>
      {children}
      {error && <p id={`${id}-err`} className="mt-1 text-xs text-danger-strong">{error}</p>}
    </div>
  );
}

/** Create a meeting, or change one you organised. Google sends the invites and updates. */
export function MeetingDialog({ target, zone, users, meId, onClose, onSaved }: Props) {
  const ws = useWorkspace();
  const original = target && 'event' in target ? target.event : undefined;
  // Mounted afresh for each target (CalendarPage keys it), so the last meeting never flashes.
  const [form, setForm] = useState<MeetingForm>(() => (target && 'event' in target ? meetingForm(target.event, zone) : newMeetingForm(target?.slot ?? null, zone)));
  const phone = useMediaQuery('(max-width: 767px)');
  const [errors, setErrors] = useState<MeetingErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [needsWrite, setNeedsWrite] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const id = useId();


  // A new start date carries the end date with it, so the meeting keeps its length.
  const moveStart = (date: string) => {
    setForm((f) => ({ ...f, date, endDate: date && f.date && f.endDate ? addDays(date, daysBetween(f.date, f.endDate)) : date }));
    clear('date'); clear('end');
  };
  const set = <K extends keyof MeetingForm>(k: K, v: MeetingForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const people = useMemo(() => users.filter((u) => u.kind !== 'agent' && u.id !== meId && u.email), [users, meId]);
  const byEmail = useMemo(() => new Map(people.map((u) => [u.email.toLowerCase(), u.name || u.username])), [people]);
  // Names Google already knows for guests who aren't teammates (rooms, outside people).
  const known = useMemo(() => new Map((original?.attendees ?? []).map((a) => [a.email.toLowerCase(), a.name])), [original]);
  const q = query.trim().toLowerCase();
  const matches = q
    ? people.filter((u) => !form.attendees.includes(u.email.toLowerCase())
      && ((u.name || u.username).toLowerCase().includes(q) || u.email.toLowerCase().includes(q))).slice(0, 5)
    : [];

  const add = (email: string) => {
    const e = email.trim().toLowerCase();
    if (!e) return;
    setForm((f) => (f.attendees.includes(e) ? f : { ...f, attendees: [...f.attendees, e] }));
    setQuery('');
    setErrors((x) => ({ ...x, attendees: undefined }));
  };
  // Typed text becomes a chip when it is an address; a name with one match picks that teammate.
  // The email it stands for, '' when nothing is typed, null (and an error shown) when it is neither.
  const resolve = (): string | null => {
    if (!q) return '';
    const email = isEmail(q) ? q : matches.length === 1 ? matches[0].email.toLowerCase() : null;
    if (email) add(email);
    else setErrors((x) => ({ ...x, attendees: `Not an email address: ${query.trim()}` }));
    return email;
  };
  const onGuestKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter takes the first teammate that matches; Tab only commits what is unambiguous, so it
    // can still move into the list of matches.
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); if (!isEmail(q) && matches[0]) add(matches[0].email); else resolve(); }
    else if (e.key === 'Tab' && q && (isEmail(q) || matches.length === 1)) { e.preventDefault(); resolve(); }
    else if (e.key === 'Backspace' && !query && form.attendees.length) set('attendees', form.attendees.slice(0, -1));
  };

  const save = async () => {
    const typed = resolve();
    if (typed === null) return;
    // What was typed has just become a chip: read the list the way it is now.
    const f = typed ? { ...form, attendees: [...new Set([...form.attendees, typed])] } : form;
    const r = meetingRequest(f, zone, original);
    if ('errors' in r) { setErrors(r.errors); return; }
    if (original && !Object.keys(r.body).length) { onClose(); return; }
    setSaving(true); setError(null);
    try {
      if (original) await updateMeeting(original.id, r.body);
      else await createMeeting(r.body as MeetingBody);
      toast(original ? 'Meeting updated' : f.attendees.length ? 'Invites sent' : 'Meeting created');
      await onSaved();
      onClose();
    } catch (err) {
      if (err instanceof CalendarWriteError && (err.needsWrite || err.reconnect)) {
        setNeedsWrite(true);
        void onSaved(); // the page's bar and New meeting learn it too
      } else setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const err = (k: keyof MeetingErrors) => (errors[k] ? { 'aria-invalid': true, 'aria-describedby': `${id}-${k}-err` } : {});
  const clear = (k: keyof MeetingErrors) => errors[k] && setErrors((x) => ({ ...x, [k]: undefined }));

  return (
    <Modal
      open={!!target}
      onOpenChange={(o) => { if (!o && !saving) onClose(); }}
      title={original ? 'Edit meeting' : 'New meeting'}
      width={520}
      className="max-h-[min(92dvh,720px)]"
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        noValidate
        onSubmit={(e) => { e.preventDefault(); void save(); }}
      >
        <fieldset disabled={saving} className="scrollarea min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 text-sm">
          <Field label="Title" id={`${id}-title`} error={errors.title}>
            <input
              id={`${id}-title`}
              // On a phone the keyboard would cover the sheet as it rises.
              autoFocus={!phone}
              value={form.title}
              maxLength={200}
              placeholder="What's it about?"
              onChange={(e) => { set('title', e.target.value); clear('title'); }}
              className={input}
              {...err('title')}
            />
          </Field>

          <div className="space-y-3">
            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-ink">
              <Switch on={form.allDay} onChange={(v) => { set('allDay', v); clear('end'); }} label="All day" disabled={saving} />
              All day
            </label>
            {/* Start date · start time, then end date · end time (Google's shape), so a meeting
                that crosses midnight or lasts days can still be moved. All day drops the times. */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start date" id={`${id}-date`} error={errors.date}>
                <input id={`${id}-date`} type="date" value={form.date} className={input} {...err('date')} onChange={(e) => moveStart(e.target.value)} />
              </Field>
              {!form.allDay && (
                <Field label="Start time" id={`${id}-start`}>
                  <input id={`${id}-start`} type="time" step={300} value={form.start} className={input} onChange={(e) => { set('start', e.target.value); clear('end'); }} />
                </Field>
              )}
              {/* All day: the end date carries the error, so it takes the id the error points at. */}
              <Field label="End date" id={form.allDay ? `${id}-end` : `${id}-enddate`} error={form.allDay ? errors.end : undefined}>
                <input
                  id={form.allDay ? `${id}-end` : `${id}-enddate`} type="date" value={form.endDate} min={form.date} className={input}
                  {...(form.allDay ? err('end') : {})}
                  onChange={(e) => { set('endDate', e.target.value); clear('end'); }}
                />
              </Field>
              {!form.allDay && (
                <Field label="End time" id={`${id}-end`} error={errors.end}>
                  <input id={`${id}-end`} type="time" step={300} value={form.end} className={input} {...err('end')} onChange={(e) => { set('end', e.target.value); clear('end'); }} />
                </Field>
              )}
            </div>
          </div>

          <Field label="Guests" id={`${id}-attendees`} error={errors.attendees}>
            <div
              className={cn(
                'flex min-h-8 flex-wrap items-center gap-1 rounded-md bg-surface px-1.5 py-1 ring-1 ring-inset ring-line transition-shadow duration-120',
                'hover:ring-line-strong focus-within:ring-2 focus-within:ring-accent',
                errors.attendees && 'ring-2 ring-danger',
              )}
            >
              {form.attendees.map((email) => {
                const name = byEmail.get(email) || known.get(email) || email;
                return (
                  <span key={email} className="flex min-w-0 max-w-full items-center gap-1 rounded-full border border-line bg-canvas py-0.5 pl-0.5 pr-0.5 text-xs text-ink" title={email}>
                    <Avatar name={name} size={18} />
                    <span className="min-w-0 truncate">{name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${name}`}
                      onClick={() => set('attendees', form.attendees.filter((a) => a !== email))}
                      className="mn-hit flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-faint transition-colors duration-120 hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:bg-selected"
                    >
                      <X size={12} />
                    </button>
                  </span>
                );
              })}
              <input
                id={`${id}-attendees`}
                value={query}
                role="combobox"
                aria-expanded={matches.length > 0}
                aria-controls={`${id}-people`}
                aria-autocomplete="list"
                autoComplete="off"
                placeholder={form.attendees.length ? 'Add another' : 'Name or email'}
                onChange={(e) => { setQuery(e.target.value.replace(/,/g, '')); clear('attendees'); }}
                onKeyDown={onGuestKey}
                onBlur={() => { if (q && isEmail(q)) add(q); }}
                className="h-6 min-w-[8rem] flex-1 bg-transparent px-1 text-sm text-ink outline-none placeholder:text-faint"
                {...err('attendees')}
              />
            </div>
            {matches.length > 0 && (
              <ul id={`${id}-people`} role="listbox" aria-label="Teammates" className="mt-1 overflow-hidden rounded-md border border-line bg-canvas p-1 shadow-pop">
                {matches.map((u) => {
                  const name = u.name || u.username;
                  return (
                    <li key={u.id} role="option" aria-selected={false}>
                      <button
                        type="button"
                        // Before the input's blur, so the pick lands rather than the typed text.
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => add(u.email)}
                        className="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left transition-colors duration-120 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none active:bg-selected"
                      >
                        <Avatar name={name} size={22} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-ink">{name}</span>
                          <span className="block truncate text-2xs text-faint">{u.email}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Field>

          <Field label="Description" id={`${id}-description`} error={errors.description}>
            <textarea
              id={`${id}-description`}
              rows={4}
              value={form.description}
              placeholder="Agenda, links, anything guests should read first"
              onChange={(e) => { set('description', e.target.value); clear('description'); }}
              className={cn(input, 'h-auto resize-y py-2 leading-relaxed')}
              {...err('description')}
            />
          </Field>

          {original?.meetLink && !original.hasMeet ? (
            // Another app's call (Zoom, Teams): not ours to remove, and Google won't add a Meet beside it.
            <p className="text-xs text-muted">This meeting has its own video link.</p>
          ) : (
            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-ink">
              <Switch on={form.meet} onChange={(v) => set('meet', v)} label="Add Google Meet" disabled={saving} />
              Add Google Meet
            </label>
          )}
        </fieldset>

        <div className="shrink-0 space-y-2.5 border-t border-line px-4 py-3">
          {error && <p role="alert" className="text-xs text-danger-strong">{error}</p>}
          {needsWrite ? (
            <div role="status" className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 basis-48 text-xs text-muted">Reconnect your calendar to send invites</p>
              <Button size="sm" onClick={() => { wantSettingsSection('mycalendar'); ws.setSettingsOpen(true); }}>Reconnect</Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {!original && <p className="mr-auto min-w-0 flex-1 text-2xs text-faint">Google emails the invites.</p>}
              <Button size="sm" variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button>
              <Button size="sm" variant="primary" type="submit" disabled={saving} aria-busy={saving}>
                {saving ? 'Saving…' : !original && form.attendees.length ? 'Send invites' : 'Save'}
              </Button>
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}
