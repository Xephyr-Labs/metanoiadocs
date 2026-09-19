// Can the browser in front of you take a push subscription at all?
//
// This is the first question to ask when someone reports that notifications do
// not arrive, because a browser with no push service rejects `subscribe()` with
// `AbortError: Registration failed - push service error` — which reads like a
// transient fault and is permanent until a browser setting changes. Brave ships
// that way; so does a Chromium build without Google's API keys.
//
//   node can-subscribe.mjs [path-to-browser]      (default: brave-browser)
//
// Needs no dependencies and no metanoiadocs: it serves its own page, generates
// its own VAPID public key and drives the browser over CDP.

import { generateKeyPairSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const exe = process.argv[2] || 'brave-browser';
const PORT = 8098;
const DEBUG_PORT = 9333;
const here = path.dirname(new URL(import.meta.url).pathname);

const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const vapid = publicKey.export({ format: 'der', type: 'spki' }).subarray(-65).toString('base64url');

const server = http.createServer((req, res) => {
  const file = req.url === '/sw.js' ? 'sw-noop.js' : 'can-subscribe.html';
  const body =
    file === 'sw-noop.js'
      ? "self.addEventListener('push', () => {});"
      : fs.readFileSync(path.join(here, 'can-subscribe.html'), 'utf8');
  res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : 'text/html');
  res.end(body);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'push-probe-'));
const browser = spawn(
  exe,
  [
    '--headless=new',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${DEBUG_PORT}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (code) => {
  browser.kill();
  server.close();
  fs.rmSync(profile, { recursive: true, force: true });
  process.exit(code);
};

let targets = [];
for (let i = 0; i < 40; i += 1) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    if (targets.some((t) => t.type === 'page')) break;
  } catch {
    /* the browser is still starting */
  }
  await wait(500);
}
const page = targets.find((t) => t.type === 'page');
if (!page) {
  console.error(`no page target — is ${exe} installed?`);
  done(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let id = 0;
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = (id += 1);
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

await send('Browser.grantPermissions', {
  origin: `http://127.0.0.1:${PORT}`,
  permissions: ['notifications'],
});
await send('Page.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await wait(2500);

const out = await send('Runtime.evaluate', {
  expression: `probe(${JSON.stringify(vapid)})`,
  awaitPromise: true,
  returnByValue: true,
  timeout: 40000,
});
const value = out.result?.result?.value;
console.log(JSON.stringify(value ?? out, null, 2));
done(value && String(value.result).startsWith('SUBSCRIBED') ? 0 : 1);
