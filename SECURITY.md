# Security

## Reporting a vulnerability

Please report security issues privately, through
[GitHub Security Advisories](https://github.com/Xephyr-Labs/metanoiadocs/security/advisories/new),
not as a public issue. That gives us a chance to fix it before it is known.

Tell us what you found, how to reproduce it, and what an attacker gets out of
it. A proof of concept helps; a working exploit is not required.

What to expect:

- An acknowledgement within **three days**.
- An assessment — is it a vulnerability, how bad, what is affected — within
  **seven days**.
- A fix released as fast as the severity warrants, and credit in the advisory
  unless you would rather not be named.

Supported: the latest release and the `latest` image built from `main`. There
are no long-term support branches yet.

## What is in scope

The server, the SPA, the MCP server and the runner, as shipped. Also in scope:
anything that lets one member read or change what they should not, anything that
lets an unauthenticated request past the door, and anything that lets a workspace
secret out.

Out of scope, because they are what self-hosting means:

- **Whoever runs the instance can read the database.** An admin is trusted with
  the workspace's contents by definition.
- **A webhook pointing at a private address.** Only an admin can configure one,
  and an admin can already reach everything the server can.
- **Missing rate limits on an instance you run.** Sign-in is throttled; a public
  instance wants a reverse proxy in front of it regardless.
- **A missing security header that your reverse proxy is meant to set** (HSTS,
  CSP on a custom domain).

## Running it safely

- **Terminate TLS in front of it.** Put Caddy, nginx or Traefik on `:8092` and
  set `BASE_URL` to the `https://` address. Sign-in links, cookies and Web Push
  all assume it.
- **Set `DB_PASSWORD`.** The default exists so a trial boots, and the database
  port is never published to the host — but a real deployment sets it.
- **Turn `AUTH_DEV_MODE` off** once SMTP is configured. While it is on, sign-in
  and invite links are printed to the server log instead of being emailed, which
  means anyone who can read the log can sign in as anyone.
- **Narrow `ALLOWED_EMAIL_DOMAINS`.** `*` lets any invited address in; an empty
  value denies everything.
- **Treat personal access tokens as passwords.** A token carries its owner's
  access in full. Revoke one in Settings → API tokens the moment it leaks.
- **Keep webhook secrets secret, and check them.** Every delivery is signed with
  HMAC-SHA256 over `<timestamp>.<raw body>`. Verify the signature and reject
  anything more than a few minutes old — the timestamp is inside the signed
  string precisely so a captured delivery cannot be replayed at you later.
