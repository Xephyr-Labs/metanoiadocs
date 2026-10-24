import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDeepgramKey, cleanTranscriptionSettings, listenUrl, readListen, shouldAutoTranscribe, transcribable, transcribeAudio } from './transcribe.js';

const reply = (transcript, detected) => ({
  results: { channels: [{ detected_language: detected, alternatives: [{ transcript }] }] },
});
/** A fake fetch that answers each call in turn and records what was asked. */
function fakeFetch(...answers) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    const a = answers[calls.length - 1];
    if (a instanceof Error) throw a;
    return { ok: a.status ? a.status < 300 : true, status: a.status ?? 200, json: async () => a.body ?? a, text: async () => JSON.stringify(a.body ?? a) };
  };
  fn.calls = calls;
  return fn;
}
const BASE = 'https://api.deepgram.com';

test('listenUrl: nova-3, smart format, and the language mode', () => {
  assert.equal(listenUrl(BASE, 'detect'), 'https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&detect_language=true');
  assert.equal(listenUrl(BASE, 'bn'), 'https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&language=bn');
  assert.equal(listenUrl('http://stub:9/', 'en'), 'http://stub:9/v1/listen?model=nova-3&smart_format=true&language=en');
});

test('readListen: the first alternative and the detected language, trimmed', () => {
  assert.deepEqual(readListen(reply('  hello there ', 'en')), { text: 'hello there', language: 'en' });
  assert.deepEqual(readListen({}), { text: '', language: undefined });
});

test('auto: English detected is kept, one call', async () => {
  const f = fakeFetch(reply('hello team', 'en'));
  const r = await transcribeAudio({ apiKey: 'k', language: 'auto', mime: 'audio/webm', data: Buffer.from('x'), base: BASE, fetch: f });
  assert.deepEqual(r, { text: 'hello team', language: 'en' });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].init.headers.Authorization, 'Token k');
  assert.equal(f.calls[0].init.headers['Content-Type'], 'audio/webm');
});

test('auto: anything else (Deepgram hears Bangla as Hindi) is redone as Bangla', async () => {
  const f = fakeFetch(reply('kuch', 'hi'), reply('আমরা কাল দেখা করব', undefined));
  const r = await transcribeAudio({ apiKey: 'k', language: 'auto', mime: 'audio/mp4', data: Buffer.from('x'), base: BASE, fetch: f });
  assert.deepEqual(r, { text: 'আমরা কাল দেখা করব', language: 'bn' });
  assert.match(f.calls[1].url, /language=bn/);
});

test('auto: an empty Bangla pass keeps the first pass rather than losing it', async () => {
  const f = fakeFetch(reply('something', 'hi'), reply('', undefined));
  const r = await transcribeAudio({ apiKey: 'k', language: 'auto', mime: 'audio/mp4', data: Buffer.from('x'), base: BASE, fetch: f });
  assert.deepEqual(r, { text: 'something', language: 'hi' });
});

test('a fixed language is one call in that language', async () => {
  const f = fakeFetch(reply('আচ্ছা', undefined));
  const r = await transcribeAudio({ apiKey: 'k', language: 'bn', mime: 'audio/mp4', data: Buffer.from('x'), base: BASE, fetch: f });
  assert.deepEqual(r, { text: 'আচ্ছা', language: 'bn' });
  assert.equal(f.calls.length, 1);
});

test('a Deepgram error throws with its status, so the caller can record it', async () => {
  const f = fakeFetch({ status: 401, body: { err_msg: 'Invalid credentials.' } });
  await assert.rejects(
    transcribeAudio({ apiKey: 'bad', language: 'en', mime: 'audio/mp4', data: Buffer.from('x'), base: BASE, fetch: f }),
    /Deepgram 401/,
  );
});

test('cleanTranscriptionSettings: blank key keeps the stored one, unknown language falls back to auto', () => {
  const stored = { enabled: true, apiKey: 'old', language: 'bn' };
  assert.deepEqual(cleanTranscriptionSettings({ apiKey: '  ' }, stored), { enabled: true, apiKey: 'old', language: 'bn' });
  assert.deepEqual(cleanTranscriptionSettings({ apiKey: ' new ', language: 'xx', enabled: false }, stored), { enabled: false, apiKey: 'new', language: 'auto' });
  assert.deepEqual(cleanTranscriptionSettings({}, null), { enabled: false, apiKey: '', language: 'auto' });
});

test('shouldAutoTranscribe: a marked voice note up to 10 MB, only when switched on with a key', () => {
  const on = { enabled: true, apiKey: 'k', language: 'auto' };
  assert.equal(shouldAutoTranscribe(on, 'audio/webm', 2_000_000, true), true);
  assert.equal(shouldAutoTranscribe(on, 'audio/webm', 2_000_000, false), false, 'an attached audio file waits to be asked');
  assert.equal(shouldAutoTranscribe(on, 'audio/mp4', 11 * 1024 * 1024, true), false);
  assert.equal(shouldAutoTranscribe(on, 'image/png', 1000, true), false);
  assert.equal(shouldAutoTranscribe({ ...on, enabled: false }, 'audio/webm', 1000, true), false);
  assert.equal(shouldAutoTranscribe({ ...on, apiKey: '' }, 'audio/webm', 1000, true), false);
  assert.equal(shouldAutoTranscribe(null, 'audio/webm', 1000, true), false);
});

test('transcribable: audio up to 10 MB, on any path', () => {
  assert.equal(transcribable('audio/mpeg', 10 * 1024 * 1024), true);
  assert.equal(transcribable('audio/mpeg', 10 * 1024 * 1024 + 1), false);
  assert.equal(transcribable('video/mp4', 100), false);
});

test('checkDeepgramKey: a refusal is false, an outage throws', async () => {
  assert.equal(await checkDeepgramKey('k', { fetch: fakeFetch({ status: 200, body: {} }) }), true);
  assert.equal(await checkDeepgramKey('k', { fetch: fakeFetch({ status: 401, body: {} }) }), false);
  await assert.rejects(checkDeepgramKey('k', { fetch: fakeFetch({ status: 503, body: {} }) }), /Deepgram 503/);
  await assert.rejects(checkDeepgramKey('k', { fetch: fakeFetch(new Error('getaddrinfo ENOTFOUND')) }), /ENOTFOUND/);
});
