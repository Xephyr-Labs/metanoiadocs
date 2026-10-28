// A stand-in for Google in the e2e stack: OAuth (auth, token, revoke), the Calendar API (read and
// write, in memory), and an OpenAI-compatible chat endpoint for Ask AI.
// POST /control {"scope":"readonly"|"write"} picks what the next consent grants; the tokens carry it,
// and a write with a read-only token gets Google's insufficientPermissions 403.
import { createServer } from 'node:http';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const SCOPES = {
  write: 'openid email https://www.googleapis.com/auth/calendar.events',
  readonly: 'openid email https://www.googleapis.com/auth/calendar.events.readonly',
};
let grant = 'write';
const stats = { revokes: 0, tokens: 0, refreshes: 0, lists: 0, writes: [] };
const EVENTS = '/calendar/v3/calendars/primary/events';
const PAGE = 3; // small, so a week's list takes more than one page

const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const at = (n, hm) => ({ dateTime: `${day(n)}T${hm}:00Z` });
const alice = (responseStatus) => ({ email: 'alice@example.com', self: true, responseStatus });
const bob = { email: 'bob@example.com', displayName: 'Bob', responseStatus: 'accepted' };
const store = new Map([
  // Today, organised by Bob: Alice is an invitee.
  { id: 'evt1', summary: 'Launch sync', description: 'Agenda: launch.', start: at(0, '10:00'), end: at(0, '10:30'),
    organizer: { email: 'bob@example.com' },
    conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.example.com/abc' }] },
    attendees: [alice('accepted'), bob, { email: 'outsider@elsewhere.org', displayName: 'Outsider', responseStatus: 'needsAction' }] },
  // Today, declined: on the Calendar page (struck), never on Home.
  { id: 'declined1', summary: 'Budget review', start: at(0, '14:00'), end: at(0, '15:00'),
    organizer: { email: 'bob@example.com' }, attendees: [alice('declined'), bob] },
  // Tomorrow, Alice's own.
  { id: 'own1', summary: 'Design crit', start: at(1, '11:00'), end: at(1, '12:00'),
    organizer: { email: 'alice@example.com', self: true }, attendees: [{ ...alice('accepted'), organizer: true }, bob] },
  // Tomorrow, one instance of a recurring meeting (Google's instance id shape).
  { id: `standup_${day(1).replaceAll('-', '')}T090000Z`, recurringEventId: 'standup', summary: 'Standup',
    start: at(1, '09:00'), end: at(1, '09:15'), organizer: { email: 'bob@example.com' }, attendees: [alice('needsAction'), bob] },
].map((e) => [e.id, { status: 'confirmed', htmlLink: `https://calendar.google.com/event?eid=${e.id}`, ...e }]));
let made = 0;

const ms = (t) => Date.parse(t?.dateTime || `${t?.date}T00:00:00Z`);

function calendar(req, u, body, send) {
  const token = /^Bearer stub-access-(readonly|write)$/.exec(req.headers.authorization || '')?.[1];
  if (!token) return send(401, { error: { code: 401 } });
  const write = req.method !== 'GET';
  if (write && token !== 'write') {
    return send(403, { error: { code: 403, status: 'PERMISSION_DENIED', errors: [{ reason: 'insufficientPermissions' }] } });
  }
  if (write) stats.writes.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body });
  if (u.pathname === EVENTS && req.method === 'GET') {
    stats.lists++;
    const from = Date.parse(u.searchParams.get('timeMin')); const to = Date.parse(u.searchParams.get('timeMax'));
    const all = [...store.values()].filter((e) => ms(e.end) > from && ms(e.start) < to).sort((x, y) => ms(x.start) - ms(y.start));
    const off = Number(u.searchParams.get('pageToken') || 0);
    const items = all.slice(off, off + PAGE);
    return send(200, { items, ...(off + PAGE < all.length && { nextPageToken: String(off + PAGE) }) });
  }
  if (u.pathname === EVENTS && req.method === 'POST') {
    const id = `new${++made}`;
    const ev = { status: 'confirmed', ...body, id, organizer: { email: 'alice@example.com', self: true },
      attendees: [{ ...alice('accepted'), organizer: true }, ...(body.attendees || []).map((a) => ({ responseStatus: 'needsAction', ...a }))] };
    if (body.conferenceData?.createRequest && u.searchParams.get('conferenceDataVersion') === '1') ev.hangoutLink = `https://meet.google.com/${id}`;
    store.set(id, ev);
    return send(200, ev);
  }
  const id = decodeURIComponent(u.pathname.slice(EVENTS.length + 1));
  const ev = u.pathname.startsWith(`${EVENTS}/`) ? store.get(id) : null;
  if (!ev) return send(404, { error: { code: 404 } });
  if (req.method === 'GET') return send(200, ev);
  if (req.method === 'DELETE') { ev.status = 'cancelled'; return send(204, null); }
  if (req.method === 'PATCH') {
    const { attendeesOmitted, attendees, ...rest } = body;
    Object.assign(ev, rest);
    if (attendees && attendeesOmitted) {
      for (const a of attendees) Object.assign(ev.attendees.find((x) => x.email === a.email) || {}, a);
    } else if (attendees) ev.attendees = attendees;
    return send(200, ev);
  }
  return send(405, {});
}
createServer((req, res) => {
  const u = new URL(req.url, 'http://stub');
  const send = (status, body) => {
    res.writeHead(status, body === null ? {} : { 'content-type': 'application/json' });
    res.end(body === null ? undefined : JSON.stringify(body));
  };
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const form = new URLSearchParams(raw);
    let json = {};
    try { json = raw && req.headers['content-type']?.includes('json') ? JSON.parse(raw) : {}; } catch { /* not JSON */ }
    if (u.pathname === '/stats') return send(200, { ...stats, grant, events: [...store.values()] });
    if (u.pathname === '/control') { if (SCOPES[json.scope]) grant = json.scope; return send(200, { grant }); }
    if (u.pathname === '/o/oauth2/v2/auth') {
      const back = new URL(u.searchParams.get('redirect_uri'));
      back.searchParams.set('code', 'stub-code');
      back.searchParams.set('state', u.searchParams.get('state'));
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (u.pathname === '/token') {
      if (form.get('grant_type') === 'authorization_code') {
        if (form.get('code') !== 'stub-code') return send(400, { error: 'invalid_grant' });
        stats.tokens++;
        return send(200, {
          access_token: `stub-access-${grant}`, refresh_token: `stub-refresh-${grant}`, expires_in: 3600, scope: SCOPES[grant], token_type: 'Bearer',
          id_token: `${b64({ alg: 'none' })}.${b64({ email: 'alice@example.com' })}.x`,
        });
      }
      const g = /^stub-refresh-(readonly|write)$/.exec(form.get('refresh_token') || '')?.[1];
      if (!g) return send(400, { error: 'invalid_grant' });
      stats.refreshes++;
      return send(200, { access_token: `stub-access-${g}`, expires_in: 3600, scope: SCOPES[g], token_type: 'Bearer' });
    }
    if (u.pathname === '/revoke') { stats.revokes++; return send(200, {}); }
    if (u.pathname.startsWith('/calendar/v3/')) return calendar(req, u, json, send);
    if (u.pathname === '/v1/chat/completions') {
      const proposals = [
        { title: 'Share the Q3 numbers', assignee: 'bob', dueAt: '2030-01-15', sourceText: 'send deck' },
        { title: 'Book a follow-up', assignee: null, dueAt: null, sourceText: null },
      ];
      return send(200, { id: 'x', object: 'chat.completion', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(proposals) } }] });
    }
    send(404, {});
  });
}).listen(8080);
