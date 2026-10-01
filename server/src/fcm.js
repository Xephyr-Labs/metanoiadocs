// Firebase Cloud Messaging: the Android app's half of push.
//
// The app shows the server in a WebView, and a WebView has no Web Push — so a
// phone running the app gets its alerts from FCM instead, keyed by a device
// token the app registers after sign-in. Everything else about an alert (who,
// when, what it says) is decided once, in push.js; this only delivers.
//
// Off unless the operator hands in a Firebase service account, as JSON in
// FCM_SERVICE_ACCOUNT or as a file in FCM_SERVICE_ACCOUNT_FILE. Tokens are
// still accepted without it, so switching it on later reaches every phone that
// already signed in.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pool } from './db.js';

let account; // undefined: not read yet · null: not configured
function serviceAccount() {
  if (account !== undefined) return account;
  account = null;
  try {
    const file = process.env.FCM_SERVICE_ACCOUNT_FILE;
    const raw = process.env.FCM_SERVICE_ACCOUNT || (file ? fs.readFileSync(file, 'utf8') : '');
    if (!raw) return account;
    const sa = JSON.parse(raw);
    if (sa.client_email && sa.private_key && sa.project_id) account = sa;
    else console.error('[fcm] service account is missing client_email, private_key or project_id');
  } catch (err) {
    console.error('[fcm] could not read the service account:', err.message);
  }
  return account;
}

export const fcmEnabled = () => !!serviceAccount();

/** A signed JWT traded for an hour-long OAuth token — the whole of Google's
 *  service-account flow, without pulling in its SDK for one request. */
let bearer = null;
async function accessToken(sa) {
  if (bearer && bearer.expires > Date.now() + 60_000) return bearer.value;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`token exchange ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  bearer = { value: json.access_token, expires: Date.now() + json.expires_in * 1000 };
  return bearer.value;
}

/** An FCM error that means the token is dead for good (app uninstalled, data
 *  cleared) rather than a bad request or a bad day at Google. */
export const isDeadToken = (status, text) =>
  status === 404 || /UNREGISTERED|registration-token-not-registered/.test(text);

/**
 * The Android channel alerts are posted to. The app creates it at high
 * importance (MainActivity), so an alert drops down over whatever is on screen
 * and makes a sound. Without it FCM falls back to its own "Miscellaneous"
 * channel at default importance, where an alert lands silently in the shade
 * and is only noticed the next time someone opens the phone — or the app.
 * Must match MainActivity.ALERTS_CHANNEL.
 */
export const ALERTS_CHANNEL = 'metanoia_alerts';

/** The FCM v1 message for one alert, kept pure so its shape can be tested. */
export function fcmMessage(token, { title, body, tag, url }) {
  return {
    token,
    notification: { title, body },
    // The app opens this path on the server it is signed in to.
    data: { url },
    android: {
      // HIGH wakes a phone in Doze; NORMAL waits for it to wake on its own.
      priority: 'HIGH',
      // A day, the same as Web Push: past that the inbox is the better place.
      ttl: '86400s',
      notification: {
        tag,
        icon: 'ic_stat_metanoia',
        color: '#2383e2',
        channel_id: ALERTS_CHANNEL,
        notification_priority: 'PRIORITY_HIGH',
        default_sound: true,
      },
    },
  };
}

/** Send one alert to every phone the person has the app signed in on. */
export async function sendFcm(userId, { title, body, tag, url }) {
  const sa = serviceAccount();
  if (!sa) return 0;
  const { rows } = await pool.query('SELECT token FROM fcm_tokens WHERE user_id = $1', [userId]);
  if (!rows.length) return 0;

  let auth;
  try {
    auth = await accessToken(sa);
  } catch (err) {
    console.error('[fcm]', err.message);
    return 0;
  }

  await Promise.all(rows.map(async ({ token }) => {
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' },
        body: JSON.stringify({ message: fcmMessage(token, { title, body, tag, url }) }),
      });
      if (res.ok) return;
      const text = await res.text();
      if (isDeadToken(res.status, text)) {
        await pool.query('DELETE FROM fcm_tokens WHERE token = $1', [token]).catch(() => {});
        return;
      }
      console.error('[fcm] send failed:', res.status, text.slice(0, 200));
    } catch (err) {
      console.error('[fcm] send failed:', err.message);
    }
  }));
  return rows.length;
}

/** A device token as FCM issues it: long, URL-safe, no spaces. */
export const isFcmToken = (t) => typeof t === 'string' && /^[\w:.-]{32,4096}$/.test(t);
