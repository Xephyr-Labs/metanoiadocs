#!/usr/bin/env node
// Wipe every piece of workspace content and replace it with a fictional demo
// workspace, so screenshots and public demos never leak real material.
//
//   docker compose exec server node scripts/seed-demo.mjs --yes
//
// Users, sessions and API tokens are deliberately NOT touched: everyone keeps
// their login. Content authorship rotates over whoever already exists.
import crypto from 'node:crypto';
import { pool } from '../src/db.js';
import { buildDocState, collectMarkdownLinks } from '../src/blocks.js';

if (!process.argv.includes('--yes')) {
  console.error('refusing to wipe without --yes');
  process.exit(1);
}

const id = () => crypto.randomUUID();
const day = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ── content ──────────────────────────────────────────────────────────────────

const FOLDERS = [
  { key: 'company', name: 'Company', color: 'blue' },
  { key: 'product', name: 'Product', color: 'purple' },
  { key: 'specs', name: 'Specs', color: 'purple', parent: 'product' },
  { key: 'eng', name: 'Engineering', color: 'teal' },
  { key: 'design', name: 'Design', color: 'pink' },
  { key: 'marketing', name: 'Marketing', color: 'orange' },
];

const TAGS = [
  { key: 'guide', name: 'Guide', color: 'blue' },
  { key: 'roadmap', name: 'Roadmap', color: 'purple' },
  { key: 'spec', name: 'Spec', color: 'teal' },
  { key: 'eng', name: 'Engineering', color: 'green' },
  { key: 'design', name: 'Design', color: 'pink' },
  { key: 'marketing', name: 'Marketing', color: 'orange' },
  { key: 'security', name: 'Security', color: 'red' },
  { key: 'draft', name: 'Draft', color: 'gray' },
  { key: 'approved', name: 'Approved', color: 'yellow' },
];

// `by` indexes into the ACTORS rotation built from the real user list.
const DOCS = [
  {
    key: 'welcome', title: 'Welcome to the workspace', icon: '👋', folder: null,
    by: 0, fav: true, tags: ['guide'],
    md: `A shared home for everything Aurora — docs, specs, meeting notes and the
boards that turn them into shipped work.

## Where things live

| Space | What goes there |
| --- | --- |
| Company | [[handbook]], [[okrs]], [[onboarding]] |
| Product | [[roadmap]], research, specs |
| Engineering | [[architecture]], runbooks, postmortems |
| Design | [[design-system]], [[brand]] |
| Marketing | [[launch]], drafts |

## Getting around

- **Sidebar** — folders, favourites and your recent pages.
- **Projects** — kanban boards, sprints and a backlog per project.
- **Search** — press the search box for full-text across every page.
- **Right panel** — outline, comments, page info and AI on the current page.

## Conventions

1. One page per decision. Link out instead of duplicating.
2. Tag a page \`Draft\` until it has been reviewed, then \`Approved\`.
3. Anything with a date in the title is a snapshot, not a living page.

> Select any text to leave a comment. Highlights stay anchored to the passage.

Questions? Drop them in [[weekly]] and someone will pick them up.`,
  },
  {
    key: 'weekly', title: 'Weekly sync — 4 Aug', icon: '📅', folder: null, by: 1, tags: ['guide'],
    md: `**Present:** product, engineering, design
**Absent:** marketing (offsite)

## Decisions

- Realtime collaboration ships behind a flag in **Sprint 12**, general
  availability in Sprint 13.
- Mobile app v1 targets read + comment only. Editing moves to v1.1.
- We keep four kanban columns. Custom columns get revisited after launch.

## Updates

- **Engineering** — sync layer rewrite is merged; reconnect storms fixed.
- **Design** — design system tokens landed in dark mode.
- **Product** — pricing experiment wrapped, results in [[pricing]].

## Actions

- [x] Publish [[postmortem]] for the June 14 outage
- [ ] Confirm the launch date with marketing
- [ ] Cut the Sprint 13 scope down to two epics
- [ ] Book the customer advisory call for late August`,
  },
  {
    key: 'handbook', title: 'Team handbook', icon: '📘', folder: 'company', by: 0, tags: ['guide', 'approved'],
    md: `How we work, written down so nobody has to guess.

## Working hours

Core hours are 10:00–16:00 in your own timezone. Outside those, assume nobody
is waiting on an instant reply.

## Meetings

- Weekly sync, 45 minutes, notes in this workspace before the call ends.
- Sprint planning every other Monday.
- No meeting without an agenda page linked in the invite.

## Writing

We default to writing. A page beats a thread because it can be linked,
searched and corrected.

> If a discussion runs past ten messages, someone writes a page.

## Decisions

Decisions get a page with the context, the options considered and the choice.
Reversible decisions are made fast by whoever owns the area. Irreversible ones
go through the weekly sync.

## Time off

Take it. Put it in the calendar a week ahead when you can, and hand over
anything with a date attached.`,
  },
  {
    key: 'onboarding', title: 'Onboarding: your first week', icon: '🧭', folder: 'company', by: 2, tags: ['guide'],
    md: `Welcome aboard. This is everything for week one, in order.

## Day 1

- [x] Accounts: workspace, source control, CI
- [x] Read the [[handbook]]
- [ ] Introduce yourself in [[weekly]]
- [ ] Pair with your onboarding buddy for an hour

## Day 2–3

- [ ] Get the app running locally
- [ ] Read [[architecture]] and skim [[standards]]
- [ ] Ship one small fix, however tiny, end to end

## Day 4–5

- [ ] Pick up a task from the backlog labelled *good first issue*
- [ ] Sit in on a customer interview
- [ ] Write down everything that confused you — that list is your first
      contribution to this page

## Who to ask

| Area | Ask about |
| --- | --- |
| Platform | Builds, deploys, environments |
| Product | Scope, priorities, customers |
| Design | Components, tokens, patterns |

Nothing here is a test. If something takes more than thirty minutes to figure
out alone, ask.`,
  },
  {
    key: 'okrs', title: 'Company OKRs — H2 2026', icon: '🎯', folder: 'company', by: 0, tags: ['roadmap', 'approved'],
    md: `Three objectives for the half. Anything not serving one of them is a
distraction we agreed to postpone. What we are actually building, and when,
lives in [[roadmap]].

## O1 — Make collaboration feel instant

- KR1: p95 sync latency under 120 ms
- KR2: 60% of active workspaces have two or more simultaneous editors weekly
- KR3: zero data-loss incidents

## O2 — Reach teams on mobile

- KR1: mobile app v1 in both stores
- KR2: 25% of weekly active users open the app on a phone
- KR3: mobile crash-free sessions above 99.5%

## O3 — Be safe to buy

- KR1: SSO and SCIM generally available
- KR2: SOC 2 Type II fieldwork complete
- KR3: security questionnaire turnaround under three days

---

Scoring happens at the end of the half. A 0.7 is a good outcome; a 1.0 every
time means the targets were too soft.`,
  },
  {
    key: 'roadmap', title: 'Product roadmap — H2 2026', icon: '🗺️', folder: 'product', by: 1, fav: true, tags: ['roadmap', 'approved'],
    md: `What we are building, in the order we intend to build it. Dates are
intentions, not promises. The objectives this ladders up to are in [[okrs]].

## Now

- **Realtime collaboration** — presence, live cursors, conflict-free editing.
  Spec: [[prd-realtime]].
- **Inline comments** — anchored to the text, resolvable, notified.

## Next

- **Mobile app v1** — read and comment, offline cache. Spec: [[prd-mobile]].
- **SSO and SCIM** — SAML, directory sync, role mapping. Spec: [[prd-sso]].

## Later

- Custom board columns per project
- Public page publishing with custom domains
- Workspace analytics

## Explicitly not doing

| Idea | Why not |
| --- | --- |
| Per-seat billing tiers | [[pricing]] showed no lift |
| Built-in video calls | Two vendors already own this |
| Offline-first desktop app | Web plus mobile covers the ask |

> Anything in *Later* is a candidate, not a commitment. Push back before the
> planning meeting, not after.`,
  },
  {
    key: 'competitive', title: 'Competitive landscape', icon: '🔍', folder: 'product', by: 3, tags: ['roadmap'],
    md: `Refreshed quarterly. The point is to know where we genuinely differ, not
to keep a feature scoreboard.

## Where we win

- Documents and boards live in the same workspace, so a spec and its tasks
  never drift apart.
- Self-hostable, which decides most regulated deals on its own.
- No seat maths. Invite the whole team.

## Where we lose

- Mobile. Every serious competitor has shipped a phone app; ours is specced in
  [[prd-mobile]] but not built.
- Template library is thin.
- No public roadmap or changelog product.

## Segment view

| Segment | Main alternative | Our angle |
| --- | --- | --- |
| Small product teams | All-in-one wikis | Boards that share the doc model |
| Regulated / public sector | Self-hosted wikis | Self-host plus realtime |
| Agencies | Task trackers | Client-ready documents |

Pricing across the set clusters between 8 and 15 per user per month; nobody in
the segment charges for storage. Our own numbers are in [[pricing]].`,
  },
  {
    key: 'interview', title: 'Customer interview — Northwind Retail', icon: '🎤', folder: 'product', by: 4, tags: ['roadmap'],
    md: `**Who:** Head of Ops, 140-person retail chain
**Length:** 45 minutes

## Context

They run store openings from a mix of spreadsheets and a task tracker. Twelve
people touch a single opening plan; nobody trusts the version they are looking
at.

## What they said

> The plan is right in exactly one place, and that place is somebody's laptop.

- Store managers only ever have a phone. Anything desktop-only gets printed.
- Blockers are discovered in the weekly call, days after they happen.
- They tried three tools in two years. Each one lost to email.

## What we took away

1. Mobile read plus comment covers most of their need — the scope in
   [[prd-mobile]] holds. Editing is not urgent.
2. Due dates matter more than statuses — they plan by date, not by column.
3. An emailed weekly digest would remove the "did you see it?" step.

## Follow-ups

- [ ] Send the mobile beta invite when v1 hits TestFlight
- [ ] Ask whether SSO is a requirement for their IT review ([[prd-sso]])
- [ ] Book a second call with two store managers present`,
  },
  {
    key: 'pricing', title: 'Pricing experiment results', icon: '📊', folder: 'product', by: 1, tags: ['roadmap'],
    md: `Six weeks, 1,842 workspaces, split evenly across three variants.

## Variants

| Variant | Model | Conversion | ARPA |
| --- | --- | --- | --- |
| A | Flat per workspace | 4.1% | 96 |
| B | Per seat, 3 tiers | 3.4% | 88 |
| C | Flat plus usage add-ons | 4.4% | 103 |

## Read

- Per-seat pricing did not lift revenue and measurably slowed invites: teams on
  variant B invited 31% fewer members in week one.
- Usage add-ons on top of a flat plan performed best, but the gap between A and
  C sits inside the confidence interval.
- Nobody cancelled because of price. They cancelled because of empty
  workspaces.

## Decision

Stay flat per workspace. Revisit add-ons after the mobile launch, when usage
patterns are stable enough to price against.

> Activation, not pricing, is the constraint. That is where the next experiment
> should go.`,
  },
  {
    key: 'prd-realtime', title: 'PRD — Realtime collaboration', icon: '📄', folder: 'specs', by: 2, tags: ['spec', 'approved'],
    md: `## Problem

Two people editing the same page today means one of them loses work or waits.
Teams work around it by copying text into chat, which defeats the point of a
shared workspace.

## Goals

- Multiple editors on one page with no lost characters.
- See who else is on the page, and where their cursor is.
- Survive a dropped connection without the user thinking about it.

## Non-goals

- Realtime on the kanban board. Boards refresh on change; that is enough.
- Voice or video presence.

## Requirements

1. Conflict-free merging of concurrent edits.
2. Presence avatars in the page header, live cursors in the body.
3. Reconnect with backoff; queue local edits while offline.
4. Server persists state on a debounce, never on every keystroke.

The sync and storage shape these sit on is in [[architecture]]; the failure we
are designing away from is [[postmortem]].

## Success

- p95 propagation under 120 ms on a regional connection.
- Zero reported cases of lost content during the flagged rollout.

## Rollout

Behind a workspace flag in Sprint 12, default on in Sprint 13 once the flagged
cohort is clean for a full week.`,
  },
  {
    key: 'prd-mobile', title: 'PRD — Mobile app v1', icon: '📱', folder: 'specs', by: 3, tags: ['spec', 'draft'],
    md: `## Problem

Half of the people a plan affects never sit at a desk. Today they get the plan
second-hand, usually as a screenshot. [[interview]] is where this came from.

## Scope for v1

- Read any page you have access to.
- Comment and reply.
- See your assigned tasks with due dates.
- Offline cache of recently opened pages.

## Out of scope for v1

| Deferred | Lands in |
| --- | --- |
| Page editing | v1.1 |
| Board drag and drop | v1.2 |
| Push notifications | v1.1 |

## Constraints

- One codebase across both platforms.
- Cold start under two seconds on a mid-range device.
- The offline cache must never show stale content without saying so.
- Components and tokens come from [[design-system]], not from scratch.

## Open questions

- [ ] Does the reader need the outline panel, or is scrolling enough?
- [ ] How do we surface a page the user has access to but has never opened?
- [ ] Do we ship a tablet layout in v1 or wait?`,
  },
  {
    key: 'prd-sso', title: 'PRD — SSO and SCIM', icon: '🔐', folder: 'specs', by: 5, tags: ['spec', 'security', 'draft'],
    md: `## Problem

Every deal above roughly fifty people stalls on the same IT review question:
can access be managed centrally? Right now the answer is no.

## Goals

- SAML 2.0 single sign-on with the common identity providers.
- SCIM 2.0 directory sync for provisioning and deprovisioning.
- Map directory groups onto workspace roles.

## Requirements

1. Service-provider initiated and identity-provider initiated login.
2. Just-in-time user creation on first SSO login.
3. Deprovisioning through SCIM revokes sessions immediately.
4. An enforcement toggle that blocks password login once SSO is configured.
5. Every configuration change lands in an audit log.

## Security notes

- Signed assertions only; reject unsigned responses outright.
- Certificate rotation without downtime.
- Never trust the identity provider's email claim for authorisation on its own.

Where this sits in the stack: [[architecture]]. Why it is a company objective:
[[okrs]].

## Success

Security questionnaires answered in under three days, and no deal cites access
management as a blocker.`,
  },
  {
    key: 'architecture', title: 'Architecture overview', icon: '🏗️', folder: 'eng', by: 2, fav: true, tags: ['eng', 'approved'],
    md: `One React client, one Node service, one Postgres database. Everything else
is a detail.

## Shape

\`\`\`mermaid
flowchart LR
  B[Browser] -->|REST| A[API]
  B -->|WebSocket| S[Sync]
  A --> P[(Postgres)]
  S --> P
  A --> AI[AI provider]
\`\`\`

## Pieces

| Piece | Responsibility |
| --- | --- |
| Client | Editor, boards, offline cache |
| API | Auth, documents, tasks, search |
| Sync | Realtime document state |
| Postgres | Everything durable, including document state |

## Document storage

Page content is a CRDT update stored as a single row per document. The client
posts extracted plain text separately so search can index it without the
server needing to understand the editor schema.

## Why one database

Search, documents and tasks all live in Postgres. A second store would buy
speed we do not need and cost consistency we do.

\`\`\`sql
SELECT id, title FROM docs
WHERE search_tsv @@ plainto_tsquery('english', $1)
ORDER BY updated_at DESC;
\`\`\`

## Failure modes we care about

1. Sync disconnect — the client queues and replays.
2. Database failover — the API retries idempotent reads.
3. AI provider outage — degrades to no suggestions, never blocks a save.

The one that actually bit us is written up in [[postmortem]]. Endpoint shapes
are in [[api]]; the rules for code that touches any of this are in
[[standards]].`,
  },
  {
    key: 'api', title: 'API reference', icon: '🔌', folder: 'eng', by: 6, tags: ['eng'],
    md: `Authenticate with a personal access token in the \`Authorization\` header.
Tokens are created in settings and shown once.

## Documents

| Method | Path | Does |
| --- | --- | --- |
| GET | /api/docs | List pages you can see |
| POST | /api/docs | Create a page, optionally with markdown |
| GET | /api/docs/:id/text | Plain text of a page |
| POST | /api/docs/:id/content | Append or replace content |

## Example

\`\`\`bash
curl -X POST https://demo.example.com/api/docs \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Release notes","content":"# 2.0\\n\\n- Realtime editing"}'
\`\`\`

## Tasks

| Method | Path | Does |
| --- | --- | --- |
| GET | /api/projects | List boards |
| GET | /api/projects/:id/tasks | Board contents |
| POST | /api/projects/:id/tasks | Create a task |
| PATCH | /api/tasks/:id | Update status, assignee, dates |

## Rate limits

600 requests per minute per token. Exceeding it returns 429 with a
\`Retry-After\` header. Back off; do not retry in a tight loop.

What sits behind these endpoints is described in [[architecture]].`,
  },
  {
    key: 'release', title: 'Release checklist', icon: '✅', folder: 'eng', by: 4, tags: ['eng', 'approved'],
    md: `Run this every release. It is short on purpose, so there is no excuse to
skip it.

## Before

- [x] All tests green on the release branch
- [x] Database migrations reviewed by someone who did not write them
- [x] Feature flags default to off
- [ ] Changelog drafted
- [ ] Rollback plan written down, not implied

## During

- [ ] Deploy to staging, smoke test sign-in, edit, comment, board drag
- [ ] Deploy to production during working hours
- [ ] Watch error rate and sync reconnect count for fifteen minutes

## After

- [ ] Flip the flags for the pilot cohort
- [ ] Post the changelog
- [ ] Note anything that surprised you at the bottom of this page

---

Half of this list exists because of [[postmortem]]. Code review expectations
are in [[standards]].

> A release nobody can roll back is not a release, it is a commitment.`,
  },
  {
    key: 'postmortem', title: 'Postmortem — 14 June sync outage', icon: '🚨', folder: 'eng', by: 2, tags: ['eng'],
    md: `**Duration:** 41 minutes
**Impact:** Realtime editing unavailable for roughly 12% of active workspaces.
Documents stayed readable and no content was lost.

## Timeline

| Time | Event |
| --- | --- |
| 09:14 | Deploy of the sync service begins |
| 09:17 | Reconnect rate climbs sharply |
| 09:21 | First customer report |
| 09:29 | Cause identified: connection pool exhausted |
| 09:38 | Pool size raised, service restarted |
| 09:55 | Metrics back to baseline |

## Cause

The new deploy opened a database connection per socket instead of sharing the
pool. Under normal traffic the pool held; when every client reconnected at once
after the rolling restart, it did not. The pooling boundary is drawn in
[[architecture]].

## What went well

- Documents degraded to read-only rather than failing outright.
- Alerting fired four minutes before the first customer noticed.

## What went badly

- No load test covered a mass reconnect.
- The pool size was hard-coded, so the fix needed a deploy.

## Actions

- [x] Share the pool across sockets
- [x] Make pool size configurable
- [ ] Add a reconnect-storm load test to CI
- [ ] Alert on pool saturation, not just error rate

The last two are now steps in [[release]].

> Blameless. The pooling change passed review twice; the gap was in our tests,
> not in anybody's judgement.`,
  },
  {
    key: 'standards', title: 'Coding standards', icon: '📐', folder: 'eng', by: 6, tags: ['eng'],
    md: `Short rules, applied consistently, beat long rules applied occasionally.

## General

1. Prefer deleting code to adding a flag.
2. A comment explains *why*; the code already says *what*.
3. No abstraction with a single implementation.

## Reviews

- Reviews are for correctness and clarity. Formatting is the formatter's job.
- Leave the nit, mark it as a nit.
- Approve with comments rather than blocking on taste.

## Tests

Every non-trivial branch leaves one runnable check behind. We are not chasing a
coverage number; we are chasing the test that fails when the logic breaks.

\`\`\`js
// Good: fails loudly if the merge rule changes.
assert.equal(merge({ a: 1 }, { a: 2 }).a, 2);
\`\`\`

## Dependencies

Adding one is a decision, not a convenience. Ask whether the standard library
or something already installed covers it first.

Context for the code these rules govern: [[architecture]]. What ships and when:
[[release]].`,
  },
  {
    key: 'design-system', title: 'Design system foundations', icon: '🎨', folder: 'design', by: 7, tags: ['design', 'approved'],
    md: `Tokens first, components second. If a component hard-codes a value, it is a
bug in the tokens.

## Colour

| Token | Light | Dark |
| --- | --- | --- |
| canvas | #ffffff | #16181a |
| ink | #1c1f21 | #e8eaed |
| line | #e6e8eb | #2a2d30 |
| accent | #2f6fed | #6a9bff |

Every colour is a CSS variable. Dark mode swaps the variable, never the
component.

## Type

- Interface: Inter, 14px base, 1.5 line height.
- Reading column: 720px maximum, because longer lines lose the reader.
- One display face, used only for page titles.

## Spacing

A 4px scale. If a gap is not on the scale it is a mistake, not a decision.

## Motion

- 120ms for state changes, 220ms for surfaces entering.
- Nothing animates on a data update. Motion is for the user's action.

The words that go inside these components are governed by [[brand]].

> Accessibility is not a phase. Contrast at 4.5:1, focus visible everywhere,
> and every control reachable by keyboard.`,
  },
  {
    key: 'brand', title: 'Brand voice and tone', icon: '🖋️', folder: 'design', by: 7, tags: ['design', 'marketing'],
    md: `## Voice

Plain, specific, unhurried. We sound like a competent colleague, not a product
announcement.

## We do

- Lead with what the thing does.
- Use the reader's words, not our internal names.
- Give a number when we have one.

## We do not

- Say *seamless*, *revolutionary*, *game-changing*, or *effortless*.
- Use exclamation marks in the product.
- Apologise for things that are not our fault.

## Examples

| Instead of | Write |
| --- | --- |
| Seamlessly sync your work! | Edits appear for everyone within a second. |
| We're thrilled to announce | Realtime editing is available today. |
| Oops, something went wrong | We could not save this page. Retry? |

Type, colour and spacing that carry these words: [[design-system]].

> When in doubt, read it out loud. If you would not say it to someone's face,
> do not ship it.`,
  },
  {
    key: 'launch', title: 'Launch plan — Aurora 2.0', icon: '📣', folder: 'marketing', by: 5, tags: ['marketing'],
    md: `Target date: end of Sprint 13. The launch is realtime collaboration plus
inline comments ([[prd-realtime]]); mobile is teased, not announced. Scope comes
from [[roadmap]].

## Sequence

1. Changelog entry the morning of launch.
2. Blog post explaining the rewrite, published the same hour.
3. Email to active workspaces, then to dormant ones two days later.
4. Community post and a short demo recording.

## Assets

| Asset | Owner | Status |
| --- | --- | --- |
| Blog post | Marketing | Draft |
| Demo recording | Product | Not started |
| Changelog | Engineering | Not started |
| Email | Marketing | Draft |

## Messaging

Lead with the outcome — *your team edits the same page at the same time* — not
with the technology. The CRDT rewrite is [[blog]], not the headline. Tone rules
are in [[brand]].

## Risks

- Launching before the flagged cohort is clean for a full week.
- Mobile questions dominating the comments. Prepare a one-line answer.`,
  },
  {
    key: 'blog', title: 'Blog draft: why we rebuilt sync', icon: '✍️', folder: 'marketing', by: 5, tags: ['marketing', 'draft'],
    md: `> Draft. Do not publish until the flagged rollout has a clean week.

Editing the same page as a colleague used to mean one of you waited. Today it
does not. Here is what changed underneath.

## The old model

We saved whole documents. Two people editing at once meant last write wins, so
we locked the page and told the second person to come back later. It was
honest, and it was bad.

## What we replaced it with

Every edit is now a small operation that can merge with any other edit, in any
order, without a server deciding who was first. Your keystrokes apply locally
and immediately; the network catches up when it can.

## What that buys you

- Edits appear for everyone in about a tenth of a second.
- A dropped connection is no longer an event. Keep typing.
- Comments stay attached to the sentence they were about, even after the
  paragraph around them is rewritten.

## What it cost us

Six weeks, one outage that taught us about connection pools ([[postmortem]]),
and a lot of tests about reconnecting. Worth it. The shape we landed on is in
[[architecture]].

---

*Realtime editing is on for every workspace today. Nothing to enable.*`,
  },
  {
    key: 'scratch', title: 'Scratchpad', icon: '🔒', folder: null, by: 0, visibility: 'private',
    md: `Private page — only visible to its owner until it is shared.

- Rough notes for the sprint review
- Question for the platform team about the reconnect test
- Reminder: cut the Sprint 13 scope before planning`,
  },
];

const PROJECTS = [
  {
    key: 'aurora', name: 'Aurora 2.0 launch', icon: '🚀', color: 'blue', doc: 'roadmap',
    sprints: [
      { key: 's11', name: 'Sprint 11', state: 'done', start: -32, end: -18 },
      { key: 's12', name: 'Sprint 12', state: 'active', start: -4, end: 10 },
      { key: 's13', name: 'Sprint 13', state: 'planned', start: 11, end: 25 },
    ],
    tasks: [
      { key: 'e-rt', kind: 'epic', title: 'Realtime collaboration', status: 'doing', sprint: 's12', by: 2, progress: 65, points: 21, doc: 'prd-realtime' },
      { key: 'rt-crdt', kind: 'story', parent: 'e-rt', title: 'Conflict-free merge of concurrent edits', status: 'done', sprint: 's11', by: 2, points: 8, progress: 100 },
      { key: 'rt-presence', kind: 'story', parent: 'e-rt', title: 'Presence avatars and live cursors', status: 'done', sprint: 's12', by: 7, points: 5, progress: 100, deps: ['rt-crdt'] },
      { key: 'rt-reconnect', kind: 'task', parent: 'e-rt', title: 'Reconnect with exponential backoff', status: 'review', sprint: 's12', by: 6, points: 3, progress: 90, due: 3, deps: ['rt-crdt'] },
      { key: 'rt-flag', kind: 'task', parent: 'e-rt', title: 'Workspace flag for the pilot cohort', status: 'doing', sprint: 's12', by: 0, points: 2, progress: 40, due: 5 },
      { key: 'rt-loadtest', kind: 'task', parent: 'e-rt', title: 'Reconnect-storm load test in CI', status: 'todo', sprint: 's12', by: 0, points: 3, due: 8, priority: 2 },
      { key: 'rt-bug', kind: 'bug', parent: 'e-rt', title: 'Cursor label overlaps the page title at 100% zoom', status: 'todo', sprint: 's12', by: 7, points: 1, due: 6 },

      { key: 'e-comments', kind: 'epic', title: 'Inline comments', status: 'doing', sprint: 's12', by: 3, progress: 50, points: 13 },
      { key: 'c-anchor', kind: 'story', parent: 'e-comments', title: 'Anchor a comment to the selected passage', status: 'done', sprint: 's12', by: 3, points: 5, progress: 100 },
      { key: 'c-highlight', kind: 'story', parent: 'e-comments', title: 'Highlight commented text in the editor', status: 'review', sprint: 's12', by: 3, points: 3, progress: 85, due: 2, deps: ['c-anchor'] },
      { key: 'c-notify', kind: 'task', parent: 'e-comments', title: 'Notify mentions and the page owner', status: 'doing', sprint: 's12', by: 0, points: 3, progress: 30, due: 7 },
      { key: 'c-resolve', kind: 'task', parent: 'e-comments', title: 'Resolve and reopen a thread', status: 'todo', sprint: 's13', by: 4, points: 2 },
      { key: 'c-bug', kind: 'bug', parent: 'e-comments', title: 'Resolved threads still count toward the unread badge', status: 'todo', sprint: 's12', by: 6, points: 1, due: -1, priority: 3 },

      { key: 'e-mobile', kind: 'epic', title: 'Mobile app v1', status: 'todo', sprint: 's13', by: 3, points: 34, doc: 'prd-mobile' },
      { key: 'm-reader', kind: 'story', parent: 'e-mobile', title: 'Read any page you have access to', status: 'todo', sprint: 's13', by: 7, points: 8, due: 20 },
      { key: 'm-comment', kind: 'story', parent: 'e-mobile', title: 'Comment and reply from a phone', status: 'todo', sprint: 's13', by: 3, points: 5, due: 22, deps: ['m-reader'] },
      { key: 'm-offline', kind: 'task', parent: 'e-mobile', title: 'Offline cache of recently opened pages', status: 'todo', by: 6, points: 8 },
      { key: 'm-tablet', kind: 'task', parent: 'e-mobile', title: 'Decide whether a tablet layout ships in v1', status: 'todo', by: 1, points: 1 },

      { key: 'launch-ms', kind: 'task', title: 'Aurora 2.0 general availability', status: 'todo', sprint: 's13', by: 1, milestone: true, due: 25, priority: 3 },
      { key: 'launch-blog', kind: 'task', title: 'Publish the launch blog post', status: 'todo', sprint: 's13', by: 5, points: 2, due: 24, doc: 'blog', deps: ['launch-ms'] },
      { key: 'launch-demo', kind: 'task', title: 'Record the two-minute demo', status: 'todo', by: 5, points: 3 },
    ],
  },
  {
    key: 'platform', name: 'Platform reliability', icon: '⚙️', color: 'teal',
    sprints: [
      { key: 'p12', name: 'Sprint 12', state: 'active', start: -4, end: 10 },
    ],
    tasks: [
      { key: 'p-pool', kind: 'task', title: 'Share the database pool across sockets', status: 'done', sprint: 'p12', by: 2, points: 3, progress: 100 },
      { key: 'p-poolcfg', kind: 'task', title: 'Make pool size configurable', status: 'done', sprint: 'p12', by: 2, points: 1, progress: 100, deps: ['p-pool'] },
      { key: 'p-alert', kind: 'task', title: 'Alert on pool saturation, not just error rate', status: 'doing', sprint: 'p12', by: 0, points: 2, progress: 50, due: 4 },
      { key: 'p-backup', kind: 'task', title: 'Nightly backups with a restore drill', status: 'review', sprint: 'p12', by: 4, points: 5, progress: 80, due: 2 },
      { key: 'p-sso', kind: 'epic', title: 'SSO and SCIM', status: 'todo', by: 5, points: 21, doc: 'prd-sso' },
      { key: 'p-saml', kind: 'story', parent: 'p-sso', title: 'SAML 2.0 sign-in', status: 'todo', by: 5, points: 8, due: 30 },
      { key: 'p-scim', kind: 'story', parent: 'p-sso', title: 'SCIM provisioning and deprovisioning', status: 'todo', by: 6, points: 8, deps: ['p-saml'] },
      { key: 'p-audit', kind: 'task', parent: 'p-sso', title: 'Audit log for configuration changes', status: 'todo', by: 4, points: 3 },
      { key: 'p-bug', kind: 'bug', title: 'Search returns archived pages to non-members', status: 'doing', sprint: 'p12', by: 0, points: 2, progress: 20, due: -1, priority: 3 },
      { key: 'p-upgrade', kind: 'task', title: 'Upgrade Postgres to 16.4', status: 'todo', by: 6, points: 2 },
    ],
  },
  {
    key: 'website', name: 'Website redesign', icon: '🎨', color: 'pink',
    sprints: [
      { key: 'w12', name: 'Design sprint', state: 'active', start: -6, end: 8 },
    ],
    tasks: [
      { key: 'w-tokens', kind: 'story', title: 'Port the design tokens to the marketing site', status: 'done', sprint: 'w12', by: 7, points: 5, progress: 100, doc: 'design-system' },
      { key: 'w-home', kind: 'story', title: 'Rebuild the home page above the fold', status: 'doing', sprint: 'w12', by: 7, points: 8, progress: 60, due: 5, deps: ['w-tokens'] },
      { key: 'w-pricing', kind: 'story', title: 'Pricing page with the flat plan', status: 'review', sprint: 'w12', by: 5, points: 5, progress: 90, due: 3, doc: 'pricing' },
      { key: 'w-docs', kind: 'task', title: 'Move the API reference onto the docs site', status: 'todo', sprint: 'w12', by: 0, points: 3, due: 0, doc: 'api' },
      { key: 'w-a11y', kind: 'task', title: 'Contrast and keyboard audit before launch', status: 'todo', by: 7, points: 3, priority: 2 },
      { key: 'w-bug', kind: 'bug', title: 'Dark mode flashes white on first paint', status: 'todo', sprint: 'w12', by: 7, points: 1, due: 2 },
      { key: 'w-copy', kind: 'task', title: 'Rewrite the feature copy in the brand voice', status: 'doing', sprint: 'w12', by: 5, points: 3, progress: 35, due: 6, doc: 'brand' },
      { key: 'w-ship', kind: 'task', title: 'Website live', status: 'todo', by: 1, milestone: true, due: 14 },
    ],
  },
];

// `quote` anchors a comment to a passage: the text is marked in the document
// and gets a pip in the margin. It must appear verbatim in that page's markdown
// — the highlighter resolves it by scanning the rendered blocks, so a paraphrase
// silently degrades to an unanchored comment.
const COMMENTS = [
  { doc: 'roadmap', by: 2, body: 'Can we pull SSO forward? Two deals this quarter are blocked on it.',
    quote: 'SSO and SCIM' },
  { doc: 'roadmap', by: 1, body: 'Only if mobile slips a sprint. Bringing it to planning.', reply: 0 },
  { doc: 'prd-mobile', by: 4, body: 'Store managers asked for due dates on the task list — worth adding to v1 scope.',
    quote: 'See your assigned tasks with due dates.' },
  { doc: 'postmortem', by: 6, body: 'Load test is written, waiting on a CI runner with enough memory.', resolved: true,
    quote: 'No load test covered a mass reconnect.' },
  { doc: 'blog', by: 7, body: 'Second paragraph reads better without "underneath". Otherwise ship it.',
    quote: 'Here is what changed underneath.' },
  { doc: 'architecture', by: 3, body: 'Worth a line about how search text is kept in step with the CRDT state.',
    quote: 'posts extracted plain text separately' },
  { doc: 'architecture', by: 5, body: 'Do we want a second example here for the fuzzy path?',
    quote: 'Search, documents and tasks all live in Postgres.' },
];

// ── seed ─────────────────────────────────────────────────────────────────────

const client = await pool.connect();
try {
  const { rows: users } = await client.query(
    `SELECT id, role FROM users ORDER BY (role = 'admin') DESC, created_at`
  );
  if (!users.length) throw new Error('no users to attribute demo content to');
  const actor = (i) => users[i % users.length].id;

  await client.query('BEGIN');

  // CASCADE picks up anything referencing these, so a forgotten child table
  // cannot survive the wipe. Users, sessions and api_tokens are not listed.
  await client.query(`
    TRUNCATE task_deps, tasks, sprints, projects,
             doc_tags, tags, comments, notifications, favorites,
             doc_versions, doc_terms, doc_signals, doc_access, doc_states,
             doc_links, docs, folders, blobs
    CASCADE
  `);

  const folderId = {};
  let pos = 0;
  for (const f of FOLDERS) {
    folderId[f.key] = id();
    await client.query(
      `INSERT INTO folders (id, name, parent_id, position, color, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [folderId[f.key], f.name, f.parent ? folderId[f.parent] : null, pos++, f.color, actor(0)]
    );
  }

  const tagId = {};
  for (const t of TAGS) {
    tagId[t.key] = id();
    await client.query('INSERT INTO tags (id, name, color) VALUES ($1, $2, $3)', [tagId[t.key], t.name, t.color]);
  }

  const docId = {};
  const docOwner = {};
  // Mint every id up front so a page can [[link]] to one defined later in the
  // list — the resolver has to answer for the whole set before any state is built.
  for (const d of DOCS) docId[d.key] = id();
  const resolveLink = (key) => docId[key] ?? null;
  const titleOf = Object.fromEntries(DOCS.map((d) => [d.key, d.title]));
  // search_text is what search indexes and quotes back in snippets, so the
  // `[[key]]` markers become the titles a reader would actually have seen.
  const searchable = (md) => md.replace(/\[\[([^\]\n]+)\]\]/g, (m, k) => titleOf[k.trim()] ?? m);

  pos = 0;
  for (const d of DOCS) {
    const owner = actor(d.by);
    docOwner[d.key] = owner;
    await client.query(
      `INSERT INTO docs (id, title, icon, created_by, updated_by, folder_id, position,
                         visibility, search_text, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8, now() - ($9 || ' days')::interval,
                                             now() - ($10 || ' hours')::interval)`,
      [docId[d.key], d.title, d.icon, owner, d.folder ? folderId[d.folder] : null, pos,
       d.visibility || 'team', searchable(d.md).slice(0, 100000), String(30 - pos), String(pos * 5 + 2)]
    );
    await client.query(
      `INSERT INTO doc_access (doc_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [docId[d.key], owner]
    );
    await client.query('INSERT INTO doc_states (doc_id, state) VALUES ($1, $2)', [
      docId[d.key], Buffer.from(buildDocState(d.title, d.md, resolveLink)),
    ]);
    for (const t of d.tags || []) {
      await client.query('INSERT INTO doc_tags (doc_id, tag_id) VALUES ($1, $2)', [docId[d.key], tagId[t]]);
    }
    // Favourite the highlights for everyone, so the sidebar is populated no
    // matter who is signed in for the screenshot.
    if (d.fav) {
      for (const u of users) {
        await client.query('INSERT INTO favorites (user_id, doc_id) VALUES ($1, $2)', [u.id, docId[d.key]]);
      }
    }
    pos++;
  }

  // doc_links after every doc exists — a link to a page defined later in the
  // list would otherwise trip the foreign key. Normally the editor posts these
  // with the text save; seeded docs never pass through a client, so write them
  // here from the same source the block state was built from.
  let linkCount = 0;
  for (const d of DOCS) {
    for (const to of collectMarkdownLinks(d.md, resolveLink)) {
      if (to === docId[d.key]) continue;
      await client.query(
        'INSERT INTO doc_links (from_id, to_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [docId[d.key], to],
      );
      linkCount++;
    }
  }

  const commentId = [];
  for (const c of COMMENTS) {
    const cid = id();
    commentId.push(cid);
    const { rows: [u] } = await client.query('SELECT name, email FROM users WHERE id = $1', [actor(c.by)]);
    await client.query(
      `INSERT INTO comments (id, doc_id, body, author_id, author_name, parent_id, resolved, quote, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() - ($9 || ' hours')::interval)`,
      [cid, docId[c.doc], c.body, actor(c.by), u?.name || u?.email || 'Someone',
       c.reply === undefined ? null : commentId[c.reply], !!c.resolved, c.quote ?? null,
       String(48 - commentId.length * 6)]
    );
    // Same fan-out the app does on a real comment: tell the page owner, unless
    // they wrote it themselves.
    if (docOwner[c.doc] !== actor(c.by)) {
      await client.query(
        `INSERT INTO notifications (id, user_id, actor_id, actor_name, doc_id, comment_id, kind, body, read_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,'comment',$7,$8, now() - ($9 || ' hours')::interval)`,
        [id(), docOwner[c.doc], actor(c.by), u?.name || u?.email || 'Someone',
         docId[c.doc], cid, c.body.slice(0, 200), c.resolved ? new Date() : null,
         String(48 - commentId.length * 6)]
      );
    }
  }

  let projPos = 0;
  for (const p of PROJECTS) {
    const pid = id();
    await client.query(
      `INSERT INTO projects (id, name, icon, color, doc_id, position, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [pid, p.name, p.icon, p.color, p.doc ? docId[p.doc] : null, projPos++, actor(0)]
    );

    const sprintId = {};
    for (const s of p.sprints) {
      sprintId[s.key] = id();
      await client.query(
        `INSERT INTO sprints (id, project_id, name, start_at, end_at, state) VALUES ($1,$2,$3,$4,$5,$6)`,
        [sprintId[s.key], pid, s.name, day(s.start), day(s.end), s.state]
      );
    }

    const taskId = {};
    const perStatus = { todo: 0, doing: 0, review: 0, done: 0 };
    for (const t of p.tasks) {
      taskId[t.key] = id();
      await client.query(
        `INSERT INTO tasks (id, project_id, title, status, kind, assignee_id, sprint_id, parent_id,
                            due_at, priority, progress, points, milestone, doc_id, position,
                            created_by, updated_by, done_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16,$17)`,
        [taskId[t.key], pid, t.title, t.status, t.kind, actor(t.by),
         t.sprint ? sprintId[t.sprint] : null, t.parent ? taskId[t.parent] : null,
         t.due === undefined ? null : day(t.due), t.priority ?? 0, t.progress ?? 0,
         t.points ?? null, !!t.milestone, t.doc ? docId[t.doc] : null,
         perStatus[t.status]++, actor(t.by), t.status === 'done' ? new Date() : null]
      );
    }
    for (const t of p.tasks) {
      for (const dep of t.deps || []) {
        await client.query(
          'INSERT INTO task_deps (task_id, depends_on_id) VALUES ($1, $2)',
          [taskId[t.key], taskId[dep]]
        );
      }
    }
  }

  await client.query('COMMIT');
  console.log(
    `seeded ${FOLDERS.length} folders, ${DOCS.length} docs, ${TAGS.length} tags, ` +
    `${COMMENTS.length} comments, ${PROJECTS.length} projects, ` +
    `${PROJECTS.reduce((n, p) => n + p.tasks.length, 0)} tasks, ${linkCount} page links`
  );
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  client.release();
  await pool.end();
}
