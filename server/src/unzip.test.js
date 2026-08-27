import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from './zip.js';
import { unzipSync } from './unzip.js';

// A 1x1 red PNG — already-compressed bytes, which zipSync stores rather than
// deflates, so this exercises the method-0 path alongside the deflated one.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('round-trips what zip.js writes', () => {
  const text = '<?xml version="1.0"?><document>' + 'x'.repeat(5000) + '</document>';
  const archive = zipSync([
    { name: '[Content_Types].xml', data: text },
    { name: 'word/document.xml', data: 'hello' },
    { name: 'word/media/image1.png', data: PNG },
  ]);

  const files = unzipSync(archive);
  assert.equal(files.size, 3);
  assert.equal(files.get('[Content_Types].xml').toString('utf8'), text);
  assert.equal(files.get('word/document.xml').toString('utf8'), 'hello');
  assert.deepEqual(files.get('word/media/image1.png'), PNG);
});

test('handles both storage methods', () => {
  // The long string compresses (method 8); the PNG does not (method 0). Both
  // must come back byte-identical.
  const files = unzipSync(zipSync([
    { name: 'compressible.txt', data: 'a'.repeat(2000) },
    { name: 'incompressible.png', data: PNG },
  ]));
  assert.equal(files.get('compressible.txt').toString(), 'a'.repeat(2000));
  assert.deepEqual(files.get('incompressible.png'), PNG);
});

test('unicode entry names survive', () => {
  const files = unzipSync(zipSync([{ name: 'word/média/图片.png', data: PNG }]));
  assert.ok(files.has('word/média/图片.png'));
});

test('an empty archive is not an error', () => {
  assert.equal(unzipSync(zipSync([])).size, 0);
});

test('rejects things that are not ZIPs, by name', () => {
  // The common case: a PDF or an old .doc renamed to .docx. The message has to
  // say the file is wrong, not that some internal record was missing.
  assert.throws(() => unzipSync(Buffer.from('%PDF-1.7\n%âãÏÓ\n')), /Not a ZIP archive/);
  assert.throws(() => unzipSync(Buffer.alloc(4)), /Not a ZIP archive/);
  assert.throws(() => unzipSync(Buffer.from('')), /Not a ZIP archive/);
});

test('rejects a truncated archive', () => {
  const archive = zipSync([{ name: 'a.txt', data: 'hello world' }]);
  assert.throws(() => unzipSync(archive.subarray(0, archive.length - 10)), /truncated|not a ZIP/i);
});

test('reports an encrypted entry as password-protected', () => {
  const archive = zipSync([{ name: 'a.txt', data: 'hello' }]);
  // Set the encryption bit in the central directory's flags field. Finding the
  // record by signature keeps this independent of the writer's layout.
  let p = -1;
  for (let i = 0; i + 4 <= archive.length; i++) {
    if (archive.readUInt32LE(i) === 0x02014b50) { p = i; break; }
  }
  assert.ok(p > 0, 'central directory found');
  archive.writeUInt16LE(archive.readUInt16LE(p + 8) | 0x1, p + 8);
  assert.throws(() => unzipSync(archive), /password-protected/);
});

test('survives a trailing archive comment', () => {
  // The EOCD scan has to walk back past a comment instead of assuming the
  // record sits in the last 22 bytes.
  const archive = zipSync([{ name: 'a.txt', data: 'hi' }]);
  const commented = Buffer.concat([archive, Buffer.from('a trailing comment')]);
  commented.writeUInt16LE(18, commented.length - 18 - 2);
  assert.equal(unzipSync(commented).get('a.txt').toString(), 'hi');
});
