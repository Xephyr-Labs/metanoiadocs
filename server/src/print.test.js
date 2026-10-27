import test from 'node:test';
import assert from 'node:assert/strict';
import { bodyHtml } from './print.js';

test('a panel renders as a panel, with its type and its body', () => {
  const html = bodyHtml('> [!NOTE]\n> Remember this\n> - and this');
  assert.match(html, /<div class="callout" data-panel="note"><span class="callout-icon">📝<\/span><div><p>Remember this<\/p>\n<ul>/);
});

test('palette colours, highlight, underline and sizes render as markup, not as literal tags', () => {
  const html = bodyHtml('a <span style="color: red; background: yellow">b</span> <mark>c</mark> <u>d</u> <big>e</big>');
  assert.match(html, /<span class="fg-red bg-yellow">b<\/span>/);
  assert.match(html, /<mark>c<\/mark> <u>d<\/u> <span class="big">e<\/span>/);
});

test('anything outside the palette, or any other tag, stays escaped text', () => {
  const html = bodyHtml('<span style="color: #f00; background: url(x)">x</span> <script>alert(1)</script> <span style="color: red" onclick="y">z</span>');
  assert.ok(!/<script|<span[^>]*(onclick|style)/.test(html), html);
  assert.match(html, /&lt;script&gt;/);
});
