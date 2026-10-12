// Takes every screenshot in the README, from the workspace seed.mjs made.
// 1600×1000 at 2× for desktop, an iPhone-sized 390×844 at 3× for phone.
//
//   BASE=http://localhost:8097 node readme-shots/shots.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8097';
const OUT = new URL('../../assets/screenshots/', import.meta.url).pathname;

// Home greets by time of day; pick the zone where it is mid-morning now, so
// the shots never say "Still up, Maya".
const offset = ((10 - new Date().getUTCHours() + 36) % 24) - 12;
const timezoneId = offset >= 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;

const browser = await chromium.launch();
async function signedIn(opts) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', timezoneId, colorScheme: 'light', ...opts });
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'maya', password: 'readme-demo-1' } });
  if (!r.ok()) throw new Error(`login ${r.status()} — run seed.mjs first`);
  return ctx;
}
const desktop = () => signedIn({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const phone = () => signedIn({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

const ctx = await desktop();
const docs = await (await ctx.request.get(`${BASE}/api/docs`)).json();
const projects = await (await ctx.request.get(`${BASE}/api/projects`)).json();
const launch = (docs.docs ?? docs).find((d) => d.title.startsWith('Launch plan')).id;
const website = (projects.projects ?? projects).find((p) => p.name === 'Website relaunch').id;

const settle = (page, ms = 1500) => page.waitForLoadState('networkidle').then(() => page.waitForTimeout(ms));
const shot = (page, name) => page.screenshot({ path: OUT + name + '.png' });
async function openDoc(page) {
  await page.goto(`${BASE}/d/${launch}`);
  await page.waitForSelector('affine-paragraph', { timeout: 60000 });
  await settle(page);
  // No caret blinking in the middle of the title.
  await page.evaluate(() => document.activeElement?.blur?.());
}

const page = await ctx.newPage();

await page.goto(BASE + '/');
await settle(page);
await shot(page, 'home');

// Provenance: the top of the activity card, close up.
const card = page.locator('section, div').filter({ has: page.getByText('Activity', { exact: true }) }).filter({ hasText: 'edited Design principles' }).last();
const box = await card.boundingBox();
await page.screenshot({ path: OUT + 'ai-provenance.png', clip: { x: box.x, y: box.y, width: 502, height: 502 } });

await page.getByRole('button', { name: /^Inbox/ }).click();
await settle(page, 800);
await shot(page, 'inbox');
await page.keyboard.press('Escape');

await page.getByRole('button', { name: 'Settings' }).click();
await page.getByRole('button', { name: 'Members' }).click();
await settle(page, 600);
await page.locator('div').filter({ hasText: /^Ravi Menon/ }).locator('xpath=ancestor::*[.//button][1]').getByRole('button').last().click();
await page.waitForTimeout(500);
await shot(page, 'ai-governance');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

for (const view of ['Board', 'Table', 'Gantt', 'Calendar']) {
  await page.goto(`${BASE}/db/${website}`);
  await settle(page, 800);
  await page.getByRole('button', { name: view, exact: true }).first().click();
  await settle(page);
  // Days opens on the start of the project, a month of empty columns ago.
  if (view === 'Gantt') { await page.getByText('Weeks', { exact: true }).click(); await settle(page, 800); }
  await shot(page, view.toLowerCase());
}

await openDoc(page);
await page.getByRole('button', { name: /^Comments/ }).click();
await settle(page, 800);
await shot(page, 'doc-comments');
await ctx.close();

const dark = await signedIn({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, colorScheme: 'dark' });
const darkPage = await dark.newPage();
await openDoc(darkPage);
if (!(await darkPage.evaluate(() => document.documentElement.classList.contains('dark') || document.documentElement.dataset.theme === 'dark'))) {
  await darkPage.getByRole('button', { name: 'Dark mode' }).click();
  await settle(darkPage, 800);
}
await shot(darkPage, 'doc-dark');
await dark.close();

const mobile = await phone();
const mobilePage = await mobile.newPage();
await openDoc(mobilePage);
await shot(mobilePage, 'mobile-doc');
await mobilePage.goto(BASE + '/');
await settle(mobilePage);
await shot(mobilePage, 'mobile-home');
await mobile.close();

await browser.close();
console.log('wrote', OUT);
