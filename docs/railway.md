# Deploy on Railway

Railway builds this repository's `Dockerfile`, runs the container, and gives it
a Postgres beside it. No server to maintain, and `railway.json` in the repo root
already carries the build and health-check settings.

## What you get

One service on a `*.up.railway.app` hostname (or your own domain), one Postgres
with a persistent volume, and nothing else — the same single-container shape as
the Docker quick start, because that is what the image is.

## Steps

**1. Start the deploy.** The button in the README opens Railway with this
repository already filled in:

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template?template=https%3A%2F%2Fgithub.com%2FXephyr-Labs%2Fmetanoiadocs)

Or do it by hand: **New project → Deploy from GitHub repo**, pointed at your
fork. Either way Railway reads `railway.json` and builds the Dockerfile; the
first build takes a few minutes, mostly the SPA.

**2. Add Postgres.** In the same project: **New → Database → Add PostgreSQL**.

**3. Wire the two together.** On the app service, under **Variables**:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — Railway substitutes the real one |
| `BASE_URL` | Your public URL, with `https://` and no trailing slash |
| `AUTH_DEV_MODE` | `true` to start; `false` once SMTP is set |
| `PORT` | Leave unset — Railway injects it, and the server reads it |

**4. Give it a domain.** Settings → Networking → **Generate Domain**, or add
your own. Put that URL in `BASE_URL` and redeploy: emailed sign-in links and
Web Push are both built from it, so a `BASE_URL` that does not match the address
people actually use produces links that go nowhere.

**5. Open it.** The first visit shows the setup screen. The account you create
there is the admin; everyone else joins by invitation.

## Once it is up

- **Email.** While `AUTH_DEV_MODE=true`, sign-in and invite links are printed to
  the deploy logs instead of being emailed — fine for a trial, not for a team.
  Fill in the `SMTP_*` block and set `AUTH_DEV_MODE=false`.
- **Push notifications** need HTTPS, which Railway gives you, and a `BASE_URL`
  that matches it. Keys generate themselves on first use.
- **Upgrades.** Railway redeploys on every push to the branch you connected. The
  schema migrates itself on boot, so there is no migration step.
- **Backups.** Railway's Postgres has its own backup settings — turn them on.
  The database holds every page, every Yjs document state and every task; the
  container holds nothing you would miss.

Every other setting is in [`.env.example`](../.env.example), and each one is an
ordinary Railway variable.
