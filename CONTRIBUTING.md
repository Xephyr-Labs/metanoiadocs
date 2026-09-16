# Contributing

Thanks for looking. Bug reports, fixes, features and documentation are all
welcome, and none of them need permission first — open an issue if you want to
talk it through, open a pull request if you already have the change.

## Getting it running

You need [Docker](https://docs.docker.com/get-docker/) with Compose and
[Node 22+](https://nodejs.org).

```bash
git clone https://github.com/Xephyr-Labs/metanoiadocs.git && cd metanoiadocs
cp .env.example .env
docker compose up -d --build
```

That builds the image from source and starts Postgres beside it. Open
<http://localhost:8092> and create the admin account on the setup screen.

For day-to-day work you want the front-end on Vite's dev server instead, so a
change reloads in under a second:

```bash
# terminal 1 — Postgres only
docker compose up -d db

# terminal 2 — the API and the /sync WebSocket
cd server && npm install
DATABASE_URL=postgresql://metanoia:metanoia@localhost:5432/metanoiadocs npm start

# terminal 3 — the SPA, proxying /api and /sync to the server
cd web-react && npm install && npm run dev
```

The schema creates and migrates itself on every boot, so there is nothing to run
by hand and no migration step to remember. `db` publishes 5432 to the host in
`docker-compose.yaml` for exactly this reason.

## The tests

```bash
cd server    && npm test          # node:test
cd web-react && npm test          # vitest
cd web-react && npx tsc --noEmit  # vite build does not typecheck
cd runner    && npm test
```

All four run in CI on every pull request, plus a production build of the SPA. A
change that breaks any of them will not merge, so run them before you push —
they take about five seconds between them.

Tests here are plain functions asserting on plain values. There is no database
in the test suite and no fixture framework: logic worth testing gets pulled out
into a function that takes data and returns data, and that function gets a test.
If something can only be tested by standing up Postgres, that is usually a sign
it wants splitting first.

## What the code looks like

Read a neighbouring file before writing a new one. A few things that are not
obvious from a diff:

- **Comments say *why*.** What the code does is already in the code. Why it does
  it that way — the race it avoids, the surprise it prevents, the simpler thing
  that was tried and did not work — is not, and that is the part the next person
  needs at 3am. A non-obvious decision without a reason beside it will get asked
  about in review.
- **`server/src/db.js` owns the schema.** One `initSchema()`, idempotent, run on
  every boot. `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE … ADD COLUMN IF NOT
  EXISTS` for anything additive. Something genuinely one-shot goes behind a row
  in `schema_migrations`, inside a transaction, so two instances booting together
  cannot both apply it.
- **Routes live in modules, registered from `index.js`.** `registerTaskRoutes`,
  `registerWebhookRoutes` and friends take the app and their dependencies.
  Modules do not import `index.js` — anything two of them need lives in a third
  file (see `task-writes.js`), because an import cycle here is a boot failure
  with a confusing message.
- **Every handler is wrapped.** Express 4 does not catch rejected promises;
  `index.js` wraps every route method centrally, so a rejected `await` returns a
  500 rather than hanging until the client times out.
- **No new colours.** The UI paints from the tokens in `web-react/src/index.css`
  via Tailwind. A hard-coded hex will not survive dark mode.
- **The lazy version first.** Reuse what is here, reach for the standard library
  and the platform before a dependency, and do not build the general case until
  the second caller exists. A deliberate shortcut with a known ceiling gets a
  `ponytail:` comment naming the ceiling and the upgrade path.

## Commits and pull requests

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org):

```
feat(webhooks): sign deliveries with the timestamp inside the HMAC
fix(tasks): stop a re-sent status re-running its automations
docs(runner): say which flags each preset uses
```

The prefix decides the release. `feat:` is a minor bump, `fix:` a patch, and a
`!` or a `BREAKING CHANGE:` footer is a major one — release-please reads the
history and opens the release pull request, so the changelog writes itself from
what you type here.

A pull request wants: what changed, why, and how you checked it. A screenshot
for anything visual. Keep it to one subject where you can — two unrelated fixes
in one branch means neither can be merged until both are agreed.

## Reporting a bug

Say what you did, what happened, and what you expected instead. Include the
version (Settings → About), whether you are on the published image or a local
build, and anything `docker compose logs server` printed at the time.

Security bugs do **not** go in an issue — see [SECURITY.md](SECURITY.md).

## Code of conduct

Be kind. The full text is in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and it
applies to issues, pull requests and discussions alike.

## Licence

MetanoiaDocs is MIT. By contributing you agree your work is published under the
same licence, which is all the paperwork there is — there is no CLA.
