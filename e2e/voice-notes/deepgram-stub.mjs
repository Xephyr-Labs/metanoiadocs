// A stand-in for Deepgram in the e2e stack (DEEPGRAM_URL points here). It
// accepts the key "good-key", answers every recording with a fixed English
// transcript naming its size, and takes 1.5s, so a reader sees "Transcribing…".
import { createServer } from 'node:http';

let listens = 0;
createServer((req, res) => {
  const ok = req.headers.authorization === 'Token good-key';
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.url === '/count') return send(200, { listens });
  if (!ok) return send(401, { err_msg: 'Invalid credentials.' });
  if (req.url.startsWith('/v1/projects')) return send(200, { projects: [] });
  if (req.url.startsWith('/v1/listen')) {
    let n = 0;
    req.on('data', (c) => { n += c.length; });
    req.on('end', () => setTimeout(() => {
      listens++;
      send(200, { results: { channels: [{ detected_language: 'en', alternatives: [{ transcript: `Stub transcript of ${n} bytes.` }] }] } });
    }, 1500));
    return;
  }
  send(404, {});
}).listen(8080);
