import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, inviteEmail, notificationEmail, signInEmail } from './email.js';

test('a name written by a person cannot become markup in someone’s mailbox', () => {
  const { html } = inviteEmail({
    baseUrl: 'https://docs.example.com',
    inviterName: '<img src=x onerror=alert(1)>',
    email: 'sam@example.com',
  });
  assert.ok(!html.includes('<img src=x'), 'the tag is escaped, not rendered');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('a comment snippet is escaped too, and its line breaks survive', () => {
  const { html } = notificationEmail({
    subject: 'Ada commented on "Q4 plan"',
    body: 'Ada said:\n\n"5 > 3" & <done>',
    link: 'https://docs.example.com/',
  });
  assert.ok(html.includes('&quot;5 &gt; 3&quot; &amp; &lt;done&gt;'));
  assert.ok(html.includes('Ada said:'));
});

test('every mail carries a plain-text alternative, not only HTML', () => {
  const mails = [
    signInEmail({ link: 'https://docs.example.com/api/auth/verify?token=abc', minutes: 15 }),
    inviteEmail({ baseUrl: 'https://docs.example.com', inviterName: 'Ada', email: 'sam@example.com' }),
    notificationEmail({ subject: 'Ada assigned you "Ship it"', body: 'Ada assigned you "Ship it".', link: 'https://docs.example.com/' }),
  ];
  for (const m of mails) {
    assert.ok(m.subject && m.subject.length < 90, 'a subject that fits an inbox row');
    assert.ok(m.text.includes('https://docs.example.com'), 'the link survives in the text part');
    assert.ok(m.html.startsWith('<!doctype html>'));
  }
});

test('the link is also printed, because a mail gateway may rewrite the button', () => {
  const link = 'https://docs.example.com/api/auth/verify?token=abc';
  const { html } = signInEmail({ link, minutes: 15 });
  // Twice: once as the button's href, once as copyable text.
  assert.equal(html.split(link).length - 1, 2);
  assert.ok(html.includes('Or paste this into your browser'));
});

test('a link we would not follow is not given an href', () => {
  const { html } = signInEmail({ link: 'javascript:alert(1)', minutes: 15 });
  assert.ok(!html.includes('javascript:'), 'no scheme we did not vet reaches an anchor');
  assert.ok(!html.includes('<a href'), 'and with no safe target there is no button at all');
});

test('the preview line is the mail’s own summary, not the first words of the card', () => {
  const { html } = signInEmail({ link: 'https://docs.example.com/x', minutes: 15 });
  const preheader = html.indexOf('Signs you in for 15 minutes');
  assert.ok(preheader > 0);
  // Before the card, which is what a client reads it instead of. (The <title>
  // in the head is earlier still and is not what an inbox row shows.)
  assert.ok(preheader < html.indexOf('<h1'), 'it comes first, where a client reads it');
});

test('the invite says which address it is for, so the wrong one is not used', () => {
  const { html, text } = inviteEmail({ baseUrl: 'https://docs.example.com/', inviterName: 'Ada', email: 'sam@example.com' });
  assert.ok(html.includes('sam@example.com'));
  assert.ok(text.includes('sam@example.com'));
  assert.ok(!html.includes('https://docs.example.com//'), 'no doubled slash from a trailing one');
});

test('esc leaves ordinary prose alone', () => {
  assert.equal(esc('Ship the Q4 plan'), 'Ship the Q4 plan');
  assert.equal(esc(null), '');
});

test('a notification opens the page it is about, and says so on the button', () => {
  const { html, text } = notificationEmail({
    subject: 'Ada commented on "Q4 plan"',
    body: 'Can we move this?',
    link: 'https://docs.example.com/d/abc123',
  });
  assert.ok(html.includes('href="https://docs.example.com/d/abc123"'));
  assert.ok(html.includes('Open the page'));
  assert.ok(text.includes('Open the page: https://docs.example.com/d/abc123'));
});

test('a task with no page yet lands on the dashboard, and the button does not claim otherwise', () => {
  const { html } = notificationEmail({
    subject: 'Ada assigned you "Ship it"',
    body: '',
    link: 'https://docs.example.com/',
  });
  assert.ok(!html.includes('Open the page'));
  assert.ok(html.includes('Open MetanoiaDocs'));
});
