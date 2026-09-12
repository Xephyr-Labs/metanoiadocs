import { describe, expect, it } from 'vitest';
import { urlBase64ToUint8Array } from './push';

// A VAPID public key is 65 bytes: an uncompressed P-256 point, so it starts
// with 0x04. Real keys are base64url — '-' and '_' rather than '+' and '/' —
// and unpadded, which is exactly what this has to put back.
describe('urlBase64ToUint8Array', () => {
  it('round-trips bytes through unpadded base64url', () => {
    const bytes = Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : (i * 7) % 256));
    const base64url = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect([...urlBase64ToUint8Array(base64url)]).toEqual([...bytes]);
  });

  it('restores the padding base64url drops', () => {
    // 'AQID' needs none, 'AQI' needs one '=', 'AQ' needs two.
    expect([...urlBase64ToUint8Array('AQID')]).toEqual([1, 2, 3]);
    expect([...urlBase64ToUint8Array('AQI')]).toEqual([1, 2]);
    expect([...urlBase64ToUint8Array('AQ')]).toEqual([1]);
  });

  it('reads the two characters base64url swaps', () => {
    // '-_-_' is '+/+/' in standard base64, which decodes to fb ff bf.
    expect([...urlBase64ToUint8Array('-_-_')]).toEqual([0xfb, 0xff, 0xbf]);
  });

  it('is backed by an ArrayBuffer, which is what subscribe() accepts', () => {
    expect(urlBase64ToUint8Array('AQID').buffer).toBeInstanceOf(ArrayBuffer);
  });
});
