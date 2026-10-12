// What the README workspace holds. Dates are as written for the week of
// Monday 21 September 2026; seed.mjs moves them to the week it runs in.

export const pages = [
  {
    key: "launch", icon: "🚀", folder: "Marketing", tags: [["Approved", "green"], ["Marketing", "orange"]],
    title: "Launch plan — Website relaunch",
    body: "We are replacing the marketing site on 20 October. This page is the single source of truth for what ships, who owns it, and what we are deliberately leaving for November.\n\n## Goals\n\n- Cut the time to first meaningful paint on the home page from 3.1s to under 1.2s.\n- Every product page answers \"what does it cost\" above the fold.\n- One design system for the site and the app, so a change lands in both.\n- Zero regressions in organic search — the top 40 URLs keep their paths.\n\n## Timeline\n\n| Week | Milestone | Owner | Status |\n| --- | --- | --- | --- |\n| 15 Sep | Content freeze for the top 12 pages | Elena | Done |\n| 22 Sep | Design system tokens shared with the app | Ravi | In progress |\n| 6 Oct | Pricing page rebuilt on the new templates | Sam | Not started |\n| 13 Oct | Redirect map reviewed with search team | Maya | Not started |\n| 20 Oct | **Public launch** | Everyone | — |\n\n## Open questions\n\n- [x] Do we keep the blog on the old stack for launch? *Yes — it moves in November.*\n- [ ] Which two customer logos can we show without a signed release?\n- [ ] Is the pricing calculator in scope, or a link to the app?\n\n## Principles for the pages\n\n> Say the price. Show the product. Get out of the way.\n\nCopy is written for someone who already knows what the product is and wants to decide in under a minute. Every page has one primary action, and it is the same action across the site.\n\n## Redirect rule\n\nOld paths keep working. The map lives beside the site config and is checked in CI:\n\n```\n/pricing        -> /pricing            (unchanged)\n/features/*     -> /product/*          (renamed section)\n/docs/*         -> docs.example.com/*  (moved host, 301)\n```\n\n## Risks\n\n1. The pricing page depends on tokens that are not final until 22 Sep — two weeks of slack, no more.\n1. If the redirect map slips past 13 Oct, launch moves. We do not launch with broken links.",
  },
  {
    key: "roadmap", icon: "🗺️", folder: "Product", tags: [["Planning", "yellow"]],
    title: "Q4 roadmap",
    body: "Three bets, in order. If the first slips, the third is the one that moves.\n\n## 1. Website relaunch (October)\n\nThe new marketing site, on the shared design system. Tracked on the **Website relaunch** board; launch plan is its own page.\n\n## 2. Mobile app beta (November)\n\nAn installable app for the people who read more than they write. Offline reading of recently opened pages, comments, and notifications. No editor in the beta.\n\n## 3. Blog migration (November–December)\n\nMove the blog off the old stack once the site is stable. Redirects, feeds, and the author pages come with it.\n\n## Not this quarter\n\n- Public API beyond what the MCP server already exposes.\n- Workspace-level permissions finer than team / private.",
  },
  {
    key: "principles", icon: "🎨", folder: "Product", tags: [["Design", "purple"], ["Approved", "green"]],
    title: "Design principles",
    body: "Four rules we hold ourselves to. When two of them conflict, the earlier one wins.\n\n## 1. One accent, spent on meaning\n\nColour says *something happened here* — an unread message, a drop target, an error. It never says *you are here*; the page you are on is already obvious.\n\n## 2. The chrome is quieter than the content\n\nSidebar, toolbars and panels are set a step smaller and a shade lighter than the document. Nothing in the frame competes with what is inside it.\n\n## 3. Every state is designed\n\nDefault, hover, focus, active, disabled, loading, error, success. A control that skips one of these is unfinished, not minimal.\n\n## 4. Fewest surfaces\n\nA card inside a card is a smell. Pick one containment layer — usually the outer one is the wrong one.",
  },
  {
    key: "onboarding", icon: "👋", folder: "Engineering", tags: [["Guide", "blue"]],
    title: "Onboarding: your first week",
    body: "Welcome. This is the short version — everything here links to the long one.\n\n## Day one\n\n- Get your accounts: the workspace, the design tool, the staging host.\n- Read the **Design principles** page. It is four paragraphs and it explains most of our review comments.\n- Pick a starter task from the **Website relaunch** board — anything tagged `good first task`.\n\n## How we work\n\nWe write things down here before we discuss them in a call. A page with a clear question gets a faster answer than a meeting with a vague one.\n\nComments live on the page, not in chat. Tag someone with `@` and they get a notification; resolve the thread when it is settled so the page stays readable.\n\n## Who to ask\n\n| Topic | Person |\n| --- | --- |\n| Content and copy | Elena |\n| Design system | Ravi |\n| Front end and build | Sam |\n| Anything else | Maya |",
  },
  {
    key: "incident", icon: "🔥", folder: "Engineering", tags: [["Development", "teal"], ["Postmortem", "red"]],
    title: "Incident review — 9 September cache outage",
    body: "**Impact:** the staging site served stale pricing for 40 minutes. No customer impact; the production site was not affected.\n\n## What happened\n\nA deploy at 14:02 changed the cache key format without bumping the cache version. Old entries kept matching and were served until they expired naturally.\n\n## Timeline\n\n- 14:02 — deploy lands\n- 14:11 — Elena notices the old price on the staging pricing page\n- 14:18 — root cause found in the diff\n- 14:42 — cache flushed, fix deployed with a version bump\n\n## What we change\n\n- [x] Cache version is derived from the key format, so they cannot drift.\n- [ ] Staging gets the same smoke check as production.\n- [ ] A deploy that touches caching gets a second reviewer.",
  },
  {
    key: "sync", icon: "🗓️", folder: "Product", tags: [["Meeting", "gray"]],
    title: "Weekly sync — 15 September",
    body: "**Present:** Maya, Sam, Elena, Ravi\n\n## Updates\n\n- **Elena** — content freeze landed for the top 12 pages. Two pages still need legal review on the customer quotes.\n- **Ravi** — token export from the design tool works; the app side lands this week.\n- **Sam** — pricing page skeleton is up on the staging host. Needs the final tokens.\n- **Maya** — redirect map is drafted; walking it with the search team on Thursday.\n\n## Decisions\n\n1. Blog stays on the old stack for launch. Migration is a November project.\n1. We show three customer logos, not six — the three we have releases for.\n\n## Actions\n\n- [ ] Sam: wire the pricing calculator as a link to the app, not an embed.\n- [ ] Elena: chase the two legal reviews by Wednesday.\n- [ ] Ravi: share the token bundle in `#design-system` when it is in the app.",
  },
];
// ref: a handle for parent/deps. by: who created it (default maya) — the
// activity feed and the inbox are derived from this.
export const websiteRelaunch = [
  { ref: 'wr1', title: 'Design system tokens shared with the app', kind: 'epic', status: 'doing', who: 'ravi', start: '2026-09-14', due: '2026-09-25', points: 13, progress: 65 },
  { ref: 'wr2', title: 'Rebuild the pricing page on the new templates', kind: 'story', status: 'doing', who: 'sam', start: '2026-09-17', due: '2026-10-06', points: 8, progress: 30, parent: 'wr1', deps: ['wr1'], sprint: true },
  { ref: 'wr3', title: 'Content freeze for the top 12 pages', kind: 'story', status: 'done', who: 'elena', start: '2026-09-14', due: '2026-09-15', points: 5, progress: 100, sprint: true },
  { ref: 'wr4', title: 'Legal review of customer quotes', kind: 'task', status: 'review', who: 'elena', start: '2026-09-15', due: '2026-09-18', points: 2, progress: 80, sprint: true },
  { ref: 'wr5', title: 'Redirect map reviewed with the search team', kind: 'story', status: 'todo', who: 'maya', start: '2026-09-28', due: '2026-10-13', points: 5, parent: 'wr1', deps: ['wr3'], sprint: true },
  { ref: 'wr6', title: 'Home page under 1.2s first meaningful paint', kind: 'story', status: 'doing', who: 'sam', start: '2026-09-22', due: '2026-10-10', points: 8, progress: 45, parent: 'wr1', priority: 4 },
  { ref: 'wr7', title: 'Pick the three customer logos we have releases for', kind: 'task', status: 'todo', who: 'maya', start: '2026-09-14', due: '2026-09-16', points: 1, parent: 'wr1' },
  { ref: 'wr8', title: 'Pricing calculator links to the app instead of embedding it', kind: 'task', status: 'todo', who: 'sam', due: '2026-10-08', points: 2, parent: 'wr1', deps: ['wr2'], priority: 4 },
  { ref: 'wr9', title: 'Mobile nav collapses the product menu into a sheet', kind: 'bug', status: 'todo', who: 'ravi', start: '2026-09-29', due: '2026-10-03', points: 3, priority: 4, by: 'ravi' },
  { ref: 'wr10', title: 'Self-host the display face instead of pulling it from a CDN', kind: 'task', status: 'done', who: 'ravi', start: '2026-09-14', due: '2026-09-16', points: 2, progress: 100, parent: 'wr1' },
  { ref: 'wr11', title: 'Staging gets the same smoke check as production', kind: 'bug', status: 'review', who: 'sam', start: '2026-09-15', due: '2026-09-18', points: 3, progress: 100, priority: 4, by: 'sam' },
  { ref: 'wr12', title: 'Public launch', kind: 'task', status: 'todo', who: 'maya', start: '2026-10-20', due: '2026-10-20', milestone: true, priority: 4, deps: ['wr2', 'wr5', 'wr6'] },
  { ref: 'wr13', title: 'Blog stays on the old stack for launch', kind: 'task', status: 'done', who: 'elena', due: '2026-09-15', points: 1, progress: 100 },
];

export const mobileApp = [
  { ref: 'ma1', title: 'Offline reading of recently opened pages', kind: 'epic', status: 'todo', who: 'sam', start: '2026-10-13', due: '2026-11-07', points: 21 },
  { ref: 'ma2', title: 'Read any page you have access to', kind: 'story', status: 'doing', who: 'sam', start: '2026-10-06', due: '2026-10-17', points: 8, progress: 20, parent: 'ma1', by: 'sam' },
  { ref: 'ma3', title: 'Comment and reply from a phone', kind: 'story', status: 'todo', who: 'ravi', start: '2026-10-20', due: '2026-11-03', points: 5, parent: 'ma1', by: 'ravi' },
  { ref: 'ma4', title: 'Push notifications for mentions', kind: 'story', status: 'todo', who: 'maya', start: '2026-10-27', due: '2026-11-10', points: 5, parent: 'ma1' },
  { ref: 'ma5', title: 'Decide whether a tablet layout ships in the beta', kind: 'task', status: 'todo', who: 'elena', due: '2026-10-10', points: 1, by: 'elena' },
  { ref: 'ma6', title: 'Beta to the reading group', kind: 'task', status: 'todo', who: 'maya', due: '2026-11-14', milestone: true, by: 'sam' },
];
