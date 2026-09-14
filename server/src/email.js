/* Hallmark · component: transactional email shell · genre: modern-minimal
 * theme: project tokens (web-react/src/index.css — preserved, not rotated)
 * states: default · dark (prefers-color-scheme) · images-off · narrow (320px)
 *   · plain-text alternative · Outlook (no radius, no media queries)
 * contrast: ink 11.6:1 · muted 5.1:1 · white-on-accent-strong 5.1:1
 *   The app's quietest ink is a chrome tone at 3.4:1 and is not used here: an
 *   email is all prose, the small print about why it arrived included.
 * pre-emit critique: P5 H5 E5 S4 R5 V4
 *
 * Token discipline, adapted: Outlook and Gmail strip CSS custom properties, so
 * there is no var() to reference. The tokens live once as constants below and
 * are interpolated into inline styles — one named source, same rule, a medium
 * that cannot carry the usual mechanism.
 *
 * No remote images. The mark is drawn with a background colour and a letter, so
 * the mail reads identically with images blocked, which is how most people will
 * first see it. No web font either: Onest is named first for the clients that
 * happen to have it and falls through to the same system stack the app already
 * declares behind it.
 */

/** The product's own tokens. Light values inline, dark ones in the media block. */
const T = {
  canvas: '#ffffff',
  surface: '#f7f7f5',
  ink: '#37352f',
  muted: '#6f6e6a',
  line: '#e9e9e7',
  accent: '#2383e2',
  // The accent darkened until it can carry text — 5.1:1 on white, where the
  // undarkened accent is 4.0:1 and fails as lettering.
  accentStrong: '#1a6fc4',
  accentSoft: '#eaf3fc',
  font: "'Onest', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

/**
 * Everything interpolated into the HTML goes through here.
 *
 * Names, page titles and comment snippets are written by people, and an
 * unescaped apostrophe or angle bracket in someone's name is markup by the time
 * it reaches a mailbox we do not control.
 */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A URL is only ever put in an href if it is one we would follow ourselves. */
const safeUrl = (url) => (/^https?:\/\//i.test(String(url || '')) ? String(url) : '');

/**
 * The card, the mark above it, the small print below it.
 *
 * @param {object} m
 * @param {string} m.preheader  The line the inbox shows beside the subject.
 * @param {string} m.title      One short line. Not the subject repeated.
 * @param {string[]} m.body     Paragraphs, already escaped.
 * @param {{href: string, label: string, showUrl?: boolean}} [m.action]
 *   `showUrl` also prints the address as copyable text. Worth the clutter only
 *   where the address is a one-time token that cannot be found any other way —
 *   a corporate gateway that rewrites the button would otherwise strand you.
 * @param {string} [m.note]     Quiet line under the action — an expiry, a caveat.
 * @param {string} m.footnote   Why this arrived. Every transactional mail owes one.
 */
function shell({ preheader, title, body, action, note, footnote }) {
  const href = action ? safeUrl(action.href) : '';
  return `<!doctype html>
<html lang="en" style="margin:0;padding:0">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(title)}</title>
<style>
  /* Honoured by Apple Mail, iOS, Outlook.com. Gmail ignores it and may invert
     the whole mail itself — which this survives, being high-contrast ink on a
     plain ground rather than a tinted composition. */
  @media (prefers-color-scheme: dark) {
    .mn-ground { background:#191919 !important; }
    .mn-card   { background:#232323 !important; border-color:#333331 !important; }
    .mn-ink    { color:#e9e9e7 !important; }
    .mn-muted  { color:#a5a5a3 !important; }
    .mn-rule   { border-color:#333331 !important; }
    .mn-url    { background:#1e1e1e !important; border-color:#333331 !important; }
  }
  /* 320px: the gutter gives way before the text does. */
  @media only screen and (max-width:600px) {
    .mn-pad { padding-left:24px !important; padding-right:24px !important; }
    .mn-title { font-size:21px !important; }
  }
</style>
</head>
<body class="mn-ground" style="margin:0;padding:0;background:${T.surface};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(preheader)}</div>
<!-- Stops the client pulling the first line of the card into the preview after the preheader. -->
<div style="display:none;max-height:0;overflow:hidden;">&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="mn-ground" style="background:${T.surface};">
  <tr>
    <td align="center" style="padding:32px 16px 40px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">

        <tr>
          <td style="padding:0 4px 16px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="32" height="32" align="center" valign="middle" bgcolor="${T.accent}" style="width:32px;height:32px;background:${T.accent};border-radius:8px;font-family:${T.font};font-size:17px;font-weight:700;color:#ffffff;line-height:32px;">M</td>
                <td style="padding-left:10px;font-family:${T.font};font-size:15px;font-weight:600;letter-spacing:-0.01em;">
                  <span class="mn-ink" style="color:${T.ink};">Metanoia</span><span class="mn-muted" style="color:${T.muted};">Docs</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td class="mn-card" style="background:${T.canvas};border:1px solid ${T.line};border-radius:10px;overflow:hidden;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td height="3" style="height:3px;line-height:3px;font-size:0;background:${T.accent};">&nbsp;</td></tr>
              <tr>
                <td class="mn-pad" style="padding:36px 40px 40px;">
                  <h1 class="mn-title mn-ink" style="margin:0 0 14px;font-family:${T.font};font-size:24px;line-height:1.3;font-weight:600;letter-spacing:-0.015em;color:${T.ink};">${esc(title)}</h1>
                  ${body.map((p) => `<p class="mn-ink" style="margin:0 0 14px;font-family:${T.font};font-size:15px;line-height:1.6;color:${T.ink};">${p}</p>`).join('\n                  ')}
                  ${href ? `
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;">
                    <tr>
                      <td bgcolor="${T.accentStrong}" style="background:${T.accentStrong};border-radius:6px;mso-padding-alt:13px 26px;">
                        <a href="${esc(href)}" style="display:inline-block;padding:13px 26px;font-family:${T.font};font-size:15px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:6px;white-space:nowrap;">${esc(action.label)}</a>
                      </td>
                    </tr>
                  </table>
${action.showUrl ? `
                  <p class="mn-muted" style="margin:20px 0 0;font-family:${T.font};font-size:12px;line-height:1.5;color:${T.muted};">Or paste this into your browser:</p>
                  <p class="mn-url" style="margin:6px 0 0;padding:9px 11px;background:${T.surface};border:1px solid ${T.line};border-radius:6px;font-family:${T.mono};font-size:12px;line-height:1.5;color:${T.muted};word-break:break-all;">${esc(href)}</p>` : ''}` : ''}
                  ${note ? `
                  <p class="mn-muted mn-rule" style="margin:24px 0 0;padding-top:16px;border-top:1px solid ${T.line};font-family:${T.font};font-size:13px;line-height:1.55;color:${T.muted};">${note}</p>` : ''}
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td class="mn-muted" style="padding:20px 8px 0;font-family:${T.font};font-size:12px;line-height:1.55;color:${T.muted};">${footnote}</td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/**
 * The sign-in link.
 *
 * The link is the whole message, so it is the only thing on the card besides
 * the two facts that stop someone worrying about it: how long it lasts, and
 * what to do if they did not ask for it.
 */
export function signInEmail({ link, minutes }) {
  const href = safeUrl(link);
  return {
    subject: 'Your MetanoiaDocs sign-in link',
    html: shell({
      preheader: `Signs you in for ${minutes} minutes. One use.`,
      title: 'Sign in to MetanoiaDocs',
      body: ['Use the button below and you will be signed in — there is no password to remember.'],
      action: { href, label: 'Sign in', showUrl: true },
      note: `This link works once and expires in ${esc(minutes)} minutes.`,
      footnote:
        'If you did not ask to sign in, ignore this message — the link does nothing until it is opened, and it expires on its own.',
    }),
    text:
      `Sign in to MetanoiaDocs:\n\n${href}\n\n` +
      `This link expires in ${minutes} minutes and can be used once.\n\n` +
      `If you did not ask to sign in, ignore this message.`,
  };
}

/** An invitation to the workspace. Names the person who sent it — an invite from nobody reads as spam. */
export function inviteEmail({ baseUrl, inviterName, email }) {
  const href = safeUrl(baseUrl ? `${String(baseUrl).replace(/\/+$/, '')}/` : '');
  const who = inviterName ? esc(inviterName) : 'Someone';
  return {
    subject: inviterName ? `${inviterName} invited you to MetanoiaDocs` : 'You are invited to MetanoiaDocs',
    html: shell({
      preheader: `${inviterName || 'Someone'} invited you to a shared workspace for docs and tasks.`,
      title: 'You have been invited',
      body: [
        `<strong style="font-weight:600">${who}</strong> invited you to collaborate in MetanoiaDocs — a shared place for the team's pages, tasks and plans.`,
        'Open it with this address and you are in. There is no password to set up.',
      ],
      action: { href, label: 'Open MetanoiaDocs' },
      note: `The invitation is for <strong style="font-weight:600">${esc(email)}</strong>. Sign in with that address.`,
      footnote: `You are getting this because someone on the workspace added your address to it. The workspace lives at ${esc(href)}.`,
    }),
    text:
      `${inviterName || 'Someone'} invited you to collaborate in MetanoiaDocs.\n\n` +
      `Get started:\n${href}\n\n` +
      `You were invited as ${email}. Sign in with that address.`,
  };
}

/**
 * Something happened that someone should know about — a mention, a comment, an
 * assignment.
 *
 * The subject is a whole sentence at every call site, so it is the heading too.
 * `body` carries only what the subject does not already say — a comment's text,
 * say — and is often empty, which leaves the card as the one line and the way
 * back in. Restating the subject as the first paragraph is how a notification
 * ends up saying the same thing three times before it says anything.
 */
export function notificationEmail({ subject, body, link }) {
  const href = safeUrl(link);
  // The label follows the link rather than being fixed: a notification about a
  // page opens that page, but an assignment whose task has no page yet lands on
  // the dashboard, and "Open the page" would be a lie about where it goes.
  const label = /\/d\/[^/?#]+/.test(href) ? 'Open the page' : 'Open MetanoiaDocs';
  const paragraphs = String(body || '')
    .split(/\n{2,}/)
    .map((p) => esc(p.trim()).replace(/\n/g, '<br>'))
    .filter(Boolean);
  return {
    subject,
    html: shell({
      preheader: String(body || subject).replace(/\s+/g, ' ').slice(0, 140),
      title: subject,
      body: paragraphs,
      action: href ? { href, label } : undefined,
      footnote:
        'You are getting this because you are on this workspace. Notifications can be turned off in Settings.',
    }),
    text: `${body ? `${subject}\n\n${body}` : subject}${href ? `\n\n${label}: ${href}` : ''}`,
  };
}
