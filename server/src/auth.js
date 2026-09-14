import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { pool, findOrCreateUser, isEmailAllowedIn } from './db.js';
import { inviteEmail, notificationEmail, signInEmail } from './email.js';

const MAGIC_TTL_MIN = 15;
const SESSION_TTL_DAYS = 30;

// Dev mode prints the sign-in link to the server log instead of mailing it, so
// the whole flow is testable before SMTP credentials exist anywhere on this box.
const DEV = process.env.AUTH_DEV_MODE === 'true';

const mailer = DEV
  ? null
  : nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

/**
 * May this session replace the password without producing the old one?
 *
 * Only a session begun by a sign-in link. Clicking a link mailed to the
 * address proves the mailbox, which is the proof every password reset is
 * built on — and someone who has forgotten the password has no old one to
 * give. A password session proves only the password, so it must keep proving
 * it: a borrowed cookie must not be enough to lock the real owner out.
 */
export function mayReplacePassword({ sessionVia, passwordMatches }) {
  return sessionVia === 'link' || passwordMatches === true;
}

export async function requestMagicLink(email, baseUrl) {
  const clean = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error('invalid email');
  const invited = await isEmailAllowedIn(clean);
  if (!invited) {
    // Deliberately indistinguishable from success to the caller, so this
    // endpoint can't be used to enumerate who is allowed in.
    console.log(`[auth] rejected sign-in request for ${clean} (not invited)`);
    return;
  }

  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO magic_tokens (token, email, expires_at)
     VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
    [token, clean, String(MAGIC_TTL_MIN)]
  );

  const link = `${baseUrl}/api/auth/verify?token=${token}`;
  if (DEV) {
    console.log(`[auth] DEV sign-in link for ${clean}:\n    ${link}`);
    return;
  }
  try {
    const mail = signInEmail({ link, minutes: MAGIC_TTL_MIN });
    await mailer.sendMail({
      from: process.env.SMTP_FROM || 'MetanoiaDocs <no-reply@example.com>',
      to: clean,
      subject: mail.subject,
      // Both, always: a client that refuses HTML still gets the link, and a
      // mail with no plain part scores as spam on its way in.
      text: mail.text,
      html: mail.html,
    });
    console.log(`[auth] sign-in link emailed to ${clean}`);
  } catch (err) {
    console.error(`[auth] FAILED to email ${clean}:`, err.message);
    throw err;
  }
}

/**
 * Send a workspace invite email. Reuses the same transport as magic links.
 * In DEV mode (no SMTP) the invite is logged instead of mailed, so the flow
 * is testable without credentials.
 */
export async function sendInviteEmail(email, baseUrl, inviterName) {
  const clean = String(email || '').trim().toLowerCase();
  if (DEV) {
    console.log(`[invite] DEV invite for ${clean} (would email):\n    ${baseUrl}/`);
    return;
  }
  const mail = inviteEmail({ baseUrl, inviterName, email: clean });
  await mailer.sendMail({
    from: process.env.SMTP_FROM || 'MetanoiaDocs <no-reply@example.com>',
    to: clean,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
  console.log(`[invite] invite emailed to ${clean}`);
}

/**
 * Best-effort notification email (e.g. "X mentioned you"). Never throws to the
 * caller — a mail failure must not fail the comment that triggered it. In DEV
 * mode (no SMTP) it just logs.
 *
 * `body` is what happened, in prose. `link` is where to go and becomes the
 * button — passed separately rather than written into the prose, so the HTML
 * does not have to go looking for a URL inside a sentence.
 */
export async function sendNotificationEmail(to, subject, body, link) {
  const clean = String(to || '').trim().toLowerCase();
  if (!clean) return;
  if (DEV) {
    console.log(`[notify] DEV email to ${clean}: ${subject}`);
    return;
  }
  try {
    const mail = notificationEmail({ subject, body, link });
    await mailer.sendMail({
      from: process.env.SMTP_FROM || 'MetanoiaDocs <no-reply@example.com>',
      to: clean,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
  } catch (err) {
    console.error(`[notify] failed to email ${clean}:`, err.message);
  }
}

export async function consumeMagicLink(token) {
  // Mark used and read in one statement: two concurrent clicks can't both win.
  const { rows } = await pool.query(
    `UPDATE magic_tokens SET used_at = now()
      WHERE token = $1 AND used_at IS NULL AND expires_at > now()
      RETURNING email`,
    [token]
  );
  const email = rows[0]?.email;
  if (!email) return null;

  const user = await findOrCreateUser(email);
  const session = crypto.randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO sessions (token, user_id, expires_at, via)
     VALUES ($1, $2, now() + ($3 || ' days')::interval, 'link')`,
    [session, user.id, String(SESSION_TTL_DAYS)]
  );
  return { user, session };
}
