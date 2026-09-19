import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';

// The app's own worker, read from the tree rather than copied here — a copy
// would drift and the probe would go on passing against the wrong file.
const here = path.dirname(new URL(import.meta.url).pathname);
const PUSH_SW = path.join(here, '../../../../../web-react/public/push-sw.js');

const keys = webpush.generateVAPIDKeys();
webpush.setVapidDetails('mailto:probe@example.com', keys.publicKey, keys.privateKey);

const types = { '.html': 'text/html', '.js': 'application/javascript' };
const results = [];

const server = http.createServer(async (req, res) => {
  if (req.url === '/key') { res.end(keys.publicKey); return; }
  if (req.url === '/report' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { stage, data } = JSON.parse(body);
    results.push({ stage, data });
    console.log('[' + stage + ']', JSON.stringify(data).slice(0, 300));
    res.end('ok');
    if (stage === 'subscribed') {
      // Exactly what server/src/push.js sends.
      const payload = JSON.stringify({
        title: 'Rima assigned you a task',
        body: 'Ship the notification spec',
        tag: 'notif-row-id-1',
        url: '/d/abc',
      });
      try {
        const out = await webpush.sendNotification(data, payload);
        console.log('[send] status', out.statusCode);
      } catch (e) {
        console.log('[send] FAILED', e.statusCode, e.message);
        results.push({ stage: 'send-failed', data: { status: e.statusCode, message: e.message } });
      }
    }
    if (stage === 'step') return;
    if (stage === 'shown' || stage === 'timeout' || stage === 'error') {
      fs.writeFileSync(path.join(here, 'result.json'), JSON.stringify(results, null, 2));
      setTimeout(() => process.exit(0), 200);
    }
    return;
  }
  const url = req.url === '/' ? '/probe.html' : req.url.split('?')[0];
  try {
    const file = fs.readFileSync(url === '/push-sw.js' ? PUSH_SW : path.join(here, url));
    res.setHeader('Content-Type', types[url.slice(url.lastIndexOf('.'))] || 'text/plain');
    res.end(file);
  } catch { res.statusCode = 404; res.end('nope'); }
});
server.listen(8099, '127.0.0.1', () => console.log('probe server on 8099'));
setTimeout(() => { fs.writeFileSync(path.join(here, 'result.json'), JSON.stringify(results, null, 2)); process.exit(1); }, 240000);
