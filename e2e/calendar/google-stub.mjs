// A stand-in for Google in the e2e stack: OAuth (auth, token, revoke), the Calendar API,
// and an OpenAI-compatible chat endpoint for Ask AI. One refresh token, one meeting today.
import { createServer } from 'node:http';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const SCOPE = 'openid email https://www.googleapis.com/auth/calendar.events.readonly';
const stats = { revokes: 0, tokens: 0, refreshes: 0 };
const today = new Date().toISOString().slice(0, 10);

createServer((req, res) => {
  const u = new URL(req.url, 'http://stub');
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const form = new URLSearchParams(raw);
    if (u.pathname === '/stats') return send(200, stats);
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
          access_token: 'stub-access', refresh_token: 'stub-refresh', expires_in: 3600, scope: SCOPE, token_type: 'Bearer',
          id_token: `${b64({ alg: 'none' })}.${b64({ email: 'alice@example.com' })}.x`,
        });
      }
      if (form.get('refresh_token') !== 'stub-refresh') return send(400, { error: 'invalid_grant' });
      stats.refreshes++;
      return send(200, { access_token: 'stub-access', expires_in: 3600, scope: SCOPE, token_type: 'Bearer' });
    }
    if (u.pathname === '/revoke') { stats.revokes++; return send(200, {}); }
    if (u.pathname.startsWith('/calendar/v3/')) {
      if (req.headers.authorization !== 'Bearer stub-access') return send(401, { error: { code: 401 } });
      const event = {
        id: 'evt1', status: 'confirmed', summary: 'Launch sync',
        description: 'Agenda: launch.',
        start: { dateTime: `${today}T10:00:00Z` }, end: { dateTime: `${today}T10:30:00Z` },
        conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.example.com/abc' }] },
        attendees: [
          { email: 'alice@example.com', self: true, responseStatus: 'accepted' },
          { email: 'bob@example.com', displayName: 'Bob', responseStatus: 'accepted' },
          { email: 'outsider@elsewhere.org', displayName: 'Outsider', responseStatus: 'needsAction' },
        ],
      };
      if (u.pathname === '/calendar/v3/calendars/primary/events') return send(200, { items: [event] });
      if (u.pathname === '/calendar/v3/calendars/primary/events/evt1') return send(200, event);
      return send(404, { error: { code: 404 } });
    }
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
