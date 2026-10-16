import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileRow, parseServiceAccount, publicFile, signedAssertion, textRoute } from './drive.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const sa = {
  client_email: 'docs@proj.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
};

test('a pasted key must be a service-account key', () => {
  assert.deepEqual(parseServiceAccount(JSON.stringify({ type: 'service_account', ...sa, project_id: 'p' })), sa);
  assert.throws(() => parseServiceAccount('not json'), /not JSON/);
  assert.throws(() => parseServiceAccount('{"type":"authorized_user"}'), /service-account/);
});

test('the assertion is an RS256 JWT Google can verify', () => {
  const jwt = signedAssertion(sa, 1_000_000_000_000);
  const [h, c, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.iss, sa.client_email);
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/drive.readonly');
  assert.equal(claims.exp - claims.iat, 3600);
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s, 'base64url')));
});

test('a trashed file is not mirrored; a live one keeps its first parent', () => {
  assert.equal(fileRow({ id: 'a', trashed: true }), null);
  const r = fileRow({
    id: 'a', name: 'Brief', mimeType: 'application/vnd.google-apps.document', parents: ['p1'],
    size: '12', modifiedTime: '2026-10-14T00:00:00Z', lastModifyingUser: { displayName: 'Farhanaj' },
  });
  assert.equal(r.parent_id, 'p1');
  assert.equal(r.size, 12);
  assert.equal(r.modified_by, 'Farhanaj');
  assert.equal(publicFile({ ...r, mime_type: 'application/vnd.google-apps.folder' }).isFolder, true);
});

test('each kind of file has the right way to text, or none', () => {
  assert.deepEqual(textRoute('application/vnd.google-apps.document'), { export: 'text/plain' });
  assert.deepEqual(textRoute('application/vnd.google-apps.spreadsheet'), { export: 'text/csv' });
  assert.deepEqual(textRoute('application/pdf'), { pdf: true });
  assert.deepEqual(textRoute('text/markdown'), { download: true });
  assert.equal(textRoute('image/png'), null);
  assert.equal(textRoute('application/vnd.google-apps.folder'), null);
});
