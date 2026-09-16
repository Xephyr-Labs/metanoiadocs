# Deploy on Coolify

[Coolify](https://coolify.io) runs this as a Docker Compose resource on a server
you own — the same two containers as the quick start, with TLS, a domain and
redeploys handled for you.

## Steps

**1. New resource → Docker Compose.** Choose **Public Repository** and give it:

```
https://github.com/Xephyr-Labs/metanoiadocs
```

Set the compose path to `docker-compose.coolify.yml`.

**2. Let it fill in the blanks.** That file uses two Coolify magic variables:

- `SERVICE_FQDN_SERVER_3000` — Coolify generates the domain, routes it to the
  server container's port 3000, and gets the TLS certificate. The same value
  becomes `BASE_URL`, which is what emailed sign-in links and Web Push are built
  from. They have to match, which is why it is one variable used twice.
- `SERVICE_PASSWORD_DB` — a generated Postgres password, written into both the
  database and the connection string.

You do not set either by hand.

**3. Deploy.** Open the domain. The first visit shows the setup screen; the
account you create there is the admin.

## Once it is up

- **Email.** `AUTH_DEV_MODE` starts at `true`, which prints sign-in and invite
  links to the container log instead of emailing them. Good for a first look,
  bad for a team: fill in the `SMTP_*` variables in Coolify's environment editor
  and set it to `false`.
- **Your own domain.** Change it in Coolify's UI and redeploy — `BASE_URL`
  follows the FQDN automatically, so there is no second place to update.
- **Upgrades.** The compose file pulls `hmsajjad/metanoiadocs:latest`. Redeploy
  to take a new build; the schema migrates itself on boot.
- **Backups.** The `db_data` volume is the whole workspace. Point Coolify's
  scheduled backups at the `db` service — the containers are disposable, that
  volume is not.

Every other setting is an ordinary environment variable; the full list is in
[`.env.example`](../.env.example).
