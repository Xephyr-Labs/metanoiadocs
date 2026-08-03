import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { pool, findOrCreateUser, isEmailAllowedIn } from './db.js';

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
    await mailer.sendMail({
      from: process.env.SMTP_FROM || 'MetanoiaDocs <no-reply@example.com>',
      to: clean,
      subject: 'Your MetanoiaDocs sign-in link',
      text: `Sign in to MetanoiaDocs:\n\n${link}\n\nThis link expires in ${MAGIC_TTL_MIN} minutes and can be used once.`,
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
  const from = inviterName ? `${inviterName} invited you to MetanoiaDocs` : 'You are invited to MetanoiaDocs';
  const body =
    `${inviterName || 'Someone'} invited you to collaborate in MetanoiaDocs.\n\n` +
    `Create your account and get started:\n${baseUrl}/\n\n` +
    `You were invited as ${clean}.`;
  if (DEV) {
    console.log(`[invite] DEV invite for ${clean} (would email):\n    ${baseUrl}/`);
    return;
  }
  await mailer.sendMail({
    from: process.env.SMTP_FROM || 'MetanoiaDocs <no-reply@example.com>',
    to: clean,
    subject: from,
    text: body,
  });
  console.log(`[invite] invite emailed to ${clean}`);
}

/**
 * Best-effort notification email (e.g. "X mentioned you"). Never throws to the
 * caller — a mail failure must not fail the comment that triggered it. In DEV
 * mode (no SMTP) it just logs.
 */
export async function sendNotificationEmail(to, subject, text) {
  const clean = String(to || '').trim().toLowerCase();
  if (!clean) return;
  if (DEV) {
    console.log(`[notify] DEV email to ${clean}: ${subject}`);
    return;
  }
  try {
    await mailer.sendMail({
      from: process.env.SMTP_FROM || 'MetanoiaDocs <no-reply@example.com>',
      to: clean,
      subject,
      text,
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
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [session, user.id, String(SESSION_TTL_DAYS)]
  );
  return { user, session };
}
