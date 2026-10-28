import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, Video } from 'lucide-react';
import { useWorkspace } from '../../store/workspace';
import { calendarApi, wantSettingsSection, type CalendarStatus } from '../../lib/calendar';
import {
  fetchEvents, meetingLabel, meetingTime, nextMeeting, orderMeetings, otherAttendees, startNotes,
  type CalendarEvents,
} from '../../lib/calendarEvents';
import { toast } from '../../lib/toast';
import { Button } from '../ui/Button';
import { Card } from './cards';

/** Today's meetings from the person's own Google Calendar; hidden unless the connector is on. */
export function TodaysMeetings() {
  const ws = useWorkspace();
  const spaceId = ws.currentSpaceId || undefined;
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [data, setData] = useState<CalendarEvents | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    const s = await calendarApi.status().catch(() => null);
    if (n !== seq.current) return;
    setStatus(s);
    if (!s?.available || !s.connected) { setData(null); return; }
    const d = await fetchEvents(1);
    if (n === seq.current) setData(d);
  }, []);
  useEffect(() => { load(); }, [load, spaceId]);

  if (!status?.available) return null;

  if (!status.connected) {
    return (
      <div className="mb-6 flex items-center gap-2 text-sm text-muted">
        <CalendarDays size={16} aria-hidden />
        <button
          type="button"
          className="text-accent hover:underline"
          onClick={() => { wantSettingsSection('mycalendar'); ws.setSettingsOpen(true); }}
        >
          Connect your calendar
        </button>
        <span>to see today's meetings here.</span>
      </div>
    );
  }

  const events = orderMeetings(data?.events ?? []);
  const now = Date.now();
  const next = nextMeeting(events, now);

  const start = async (id: string) => {
    setBusy(id);
    try {
      const { docId } = await startNotes(id, spaceId);
      await load();
      ws.select(docId);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not start notes.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      title="Today's meetings"
      className="mb-6"
      action={data?.reconnect && (
        <Button size="sm" onClick={() => { wantSettingsSection('mycalendar'); ws.setSettingsOpen(true); }}>Reconnect</Button>
      )}
    >
      {!data ? null : events.length === 0 ? (
        <p className="text-sm text-muted">{data.reconnect ? 'Reconnect your calendar to see meetings.' : 'No meetings today'}</p>
      ) : (
        <ul className="divide-y divide-line">
          {events.map((e) => {
            const label = meetingLabel(e, now, next);
            const others = otherAttendees(e).length;
            return (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
                <span className="w-40 shrink-0 text-xs text-muted">{meetingTime(e)}</span>
                <span className="min-w-0 flex-1 basis-40">
                  <span className="block truncate text-sm text-ink">
                    {label && <span className="mr-1.5 rounded bg-hover px-1.5 py-0.5 text-2xs font-semibold text-accent">{label}</span>}
                    {e.title || 'Untitled meeting'}
                  </span>
                  {others > 0 && <span className="text-2xs text-faint">{others} {others === 1 ? 'other' : 'others'}</span>}
                </span>
                <span className="flex items-center gap-2">
                  {e.meetLink && (
                    <a
                      href={e.meetLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                    >
                      <Video size={14} aria-hidden /> Join
                    </a>
                  )}
                  {e.notesDocId ? (
                    <Button size="sm" onClick={() => ws.select(e.notesDocId!)}>Open notes</Button>
                  ) : (
                    <Button size="sm" disabled={busy !== null} onClick={() => start(e.id)}>
                      {busy === e.id ? 'Starting…' : 'Start notes'}
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
