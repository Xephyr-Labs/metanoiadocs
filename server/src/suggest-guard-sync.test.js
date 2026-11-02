// The guard on a real Hocuspocus server and socket: refused updates never
// apply, the client is told to reload, and a burst of frames is checked in order.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Hocuspocus } from '@hocuspocus/server';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { buildDocState } from './blocks.js';
import { suggestGuard } from './suggest-guard.js';

const seed = new Uint8Array(buildDocState('T', 'hello'));
const hocuspocus = new Hocuspocus({
  quiet: true,
  extensions: [
    suggestGuard('suggester'),
    { async onLoadDocument({ document }) { Y.applyUpdate(document, seed); } },
  ],
});
const server = http.createServer();
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) =>
  hocuspocus.handleConnection(ws, req, { user: { id: 'me' }, role: 'suggester' })));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
after(() => { hocuspocus.closeConnections(); server.close(); });

const S = (id, kind) => ({ id, kind, by: 'me', at: 1 });
const msg = (name, write) => { const e = encoding.createEncoder(); encoding.writeVarString(e, name); write(e); return encoding.toUint8Array(e); };
const syncUpdate = (name, u) => msg(name, (e) => { encoding.writeVarUint(e, 0); encoding.writeVarUint(e, 2); encoding.writeVarUint8Array(e, u); });
const step1 = (name) => msg(name, (e) => { encoding.writeVarUint(e, 0); encoding.writeVarUint(e, 0); encoding.writeVarUint8Array(e, Y.encodeStateVector(new Y.Doc())); });

/** A suggester's socket and local doc on page `name`. */
async function connect(name) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/`);
  const stateless = [];
  let closed = null;
  ws.on('message', (data) => {
    const d = decoding.createDecoder(new Uint8Array(data));
    decoding.readVarString(d);
    if (decoding.readVarUint(d) === 5) stateless.push(JSON.parse(decoding.readVarString(d)));
  });
  const done = new Promise((r) => ws.on('close', (code) => { closed = code; r(); }));
  await new Promise((r) => ws.on('open', r));
  ws.send(step1(name));
  let doc;
  for (let i = 0; i < 100 && !(doc = hocuspocus.documents.get(name))?.getMap('blocks').size; i++) await new Promise((r) => setTimeout(r, 10));
  const local = new Y.Doc();
  Y.applyUpdate(local, seed);
  const text = [...local.getMap('blocks').values()].find((b) => b.get('sys:flavour') === 'affine:paragraph').get('prop:text');
  const change = (fn) => { const ups = []; const h = (u) => ups.push(u); local.on('update', h); fn(text); local.off('update', h); return Y.mergeUpdates(ups); };
  const serverText = () => [...doc.getMap('blocks').values()].find((b) => b.get('sys:flavour') === 'affine:paragraph').get('prop:text').toString();
  return { ws, stateless, change, serverText, done, closed: () => closed };
}
const settle = () => new Promise((r) => setTimeout(r, 100));

test('an allowed update applies; a refused one does not, the client is told and disconnected', async () => {
  const c = await connect('p1');
  c.ws.send(syncUpdate('p1', c.change((t) => t.insert(5, '!', { mnSugg: S('i1', 'ins') }))));
  await settle();
  assert.equal(c.serverText(), 'hello!');
  c.ws.send(syncUpdate('p1', c.change((t) => t.delete(0, 1))));
  await Promise.race([c.done, new Promise((r) => setTimeout(r, 2000))]);
  assert.equal(c.serverText(), 'hello!');
  assert.deepEqual(c.stateless.map((s) => s.type), ['suggestion-refused']);
  assert.equal(c.closed(), 4403);
});

test('a burst of dependent frames is checked in order', async () => {
  const c = await connect('p2');
  const a = c.change((t) => t.insert(5, 'a', { mnSugg: S('i1', 'ins') }));
  const b = c.change((t) => t.insert(6, 'b', { mnSugg: S('i1', 'ins') }));
  const z = c.change((t) => t.insert(7, 'c', { mnSugg: S('i1', 'ins') }));
  c.ws.send(syncUpdate('p2', a));
  c.ws.send(syncUpdate('p2', b));
  c.ws.send(syncUpdate('p2', z));
  await settle();
  assert.equal(c.serverText(), 'helloabc');
  assert.deepEqual(c.stateless, []);
  c.ws.close();
});
