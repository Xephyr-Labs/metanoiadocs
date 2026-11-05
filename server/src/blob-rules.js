// Small rules for /api/blob, kept out of the route so they can be tested.
import { createHash } from 'node:crypto';

/**
 * A blob's key is the sha256 of its bytes: hex from the web uploader and the
 * importers, base64url from BlockSuite's own blob store. Writes are insert-only
 * (an existing key is never replaced), so the remaining way to tamper is to
 * claim a key before anyone uses it, with other bytes; requiring the key to be
 * the hash of what is stored closes that.
 */
export function keyMatchesBytes(key, bytes) {
  const d = createHash('sha256').update(bytes).digest();
  return key === d.toString('hex') || key === d.toString('base64url') || key === d.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Content-Disposition for a download, with the name as the file calls itself:
 * an ASCII fallback for old clients plus RFC 5987 filename* for the real one.
 * Quotes, slashes and control characters are dropped, not escaped.
 */
export function attachmentDisposition(name) {
  const clean = String(name || '').replace(/[\u0000-\u001f\u007f"\\/;]+/g, '').trim().slice(0, 120);
  if (!clean) return 'attachment';
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_').replace(/%/g, '_');
  const star = encodeURIComponent(clean).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}"; filename*=UTF-8''${star}`;
}
