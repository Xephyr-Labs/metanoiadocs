import { describe, expect, it } from 'vitest';
import {
  alertsDescription,
  classifySubscribeError,
  pushFailureText,
  urlBase64ToUint8Array,
  type PushResult,
} from './push';

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

// The rejection Chromium gives when the browser has no push service at all —
// measured in Brave 147 with notifications already granted and the worker
// ready. It reads like a transient fault and is a permanent one, so it must
// not be reported as "try again".
describe('classifySubscribeError', () => {
  it('calls a push service refusal blocked, not denied', () => {
    const err = Object.assign(new Error('Registration failed - push service error'), {
      name: 'AbortError',
    });
    expect(classifySubscribeError(err)).toEqual({
      reason: 'blocked',
      detail: 'Registration failed - push service error',
    });
  });

  it('keeps a permission error separate, because site settings fix that one', () => {
    const err = Object.assign(new Error('permission denied'), { name: 'NotAllowedError' });
    expect(classifySubscribeError(err).reason).toBe('denied');
  });

  it('survives something that is not an Error at all', () => {
    expect(classifySubscribeError('nope').reason).toBe('blocked');
    expect(classifySubscribeError(undefined).reason).toBe('blocked');
  });
});

describe('pushFailureText', () => {
  it('names the browser setting that fixes a refused subscription', () => {
    expect(pushFailureText('blocked')).toMatch(/push messaging/i);
  });

  it('has a line for every reason', () => {
    const reasons = ['unsupported', 'denied', 'no-key', 'no-worker', 'blocked', 'timeout'] as const;
    for (const reason of reasons) expect(pushFailureText(reason).length).toBeGreaterThan(10);
  });
});

// The defect this whole change exists to remove: a device that can only ever
// show alerts with a tab open used to read exactly like one that gets them with
// the app closed.
describe('alertsDescription', () => {
  const on = { denied: false, on: true, supported: true };

  it('promises background alerts only once a subscription exists', () => {
    const text = alertsDescription({ ...on, push: { ok: true } });
    expect(text).toMatch(/closed/i);
  });

  it('says foreground-only, with the reason, when the subscription failed', () => {
    const push: PushResult = { ok: false, reason: 'blocked' };
    const text = alertsDescription({ ...on, push });
    expect(text).toMatch(/only while a tab is open/i);
    expect(text).toMatch(/push messaging/i);
    expect(text).not.toMatch(/whether or not Metanoia is open/i);
  });

  it('does not promise anything about the background before it knows', () => {
    expect(alertsDescription({ ...on, push: null })).toBe('On for this device.');
  });

  it('points at site settings when the browser refused permission', () => {
    expect(alertsDescription({ denied: true, on: false, push: null, supported: true })).toMatch(
      /browser settings/i,
    );
  });

  it('offers only what the browser can do when it has no push', () => {
    const text = alertsDescription({ denied: false, on: false, push: null, supported: false });
    expect(text).toMatch(/only show them while Metanoia is open/i);
  });
});
