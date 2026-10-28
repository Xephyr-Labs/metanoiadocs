# Google Calendar setup

Lets each person see their meetings on Home and on the Calendar page, start private notes for them, create meetings and send invites, answer invites, and edit or cancel meetings they organise. Only the person's own primary calendar. Every change MetanoiaDocs makes is sent to the guests by Google (`sendUpdates=all`). Scope requested: `openid email https://www.googleapis.com/auth/calendar.events`.

The feature stays hidden until both the admin settings (steps 1-6) and the server key (step 7) are in place. With `CALENDAR_TOKEN_KEY` unset, nobody sees anything of it: no Home card, no Calendar menu item, no Calendar section, no task entries in the page menu.

`BASE_URL` must be the public `https://` address people use to reach MetanoiaDocs: it forms the OAuth redirect URI, and Google only accepts the exact URI you register.

## Admin: Google Cloud (once)

Our mail is not Google Workspace, so the app is an **External** one and must be **published**.

1. In the [Google Cloud console](https://console.cloud.google.com/) create or pick a project. Use this one project for every step below.
2. **APIs & Services > Library**: enable **Google Calendar API** in that same project. (If it is enabled in another project, every calendar call fails with a 403.)
3. **Google Auth Platform > Branding** (older consoles: **OAuth consent screen**): user type **External**; fill in the app name and support email.
4. **Google Auth Platform > Data Access**: add the scopes `https://www.googleapis.com/auth/calendar.events`, `openid` and `email`.
5. **Google Auth Platform > Audience**: **Publish app** (status **In production**). Left in **Testing**, only listed test users can connect and every connection expires after 7 days.
6. **Google Auth Platform > Clients > Create client** (older consoles: **Credentials > Create credentials > OAuth client ID**): type **Web application**. Under **Authorized redirect URIs** add `${BASE_URL}/api/calendar/google/callback`, e.g. `https://docs.example.com/api/calendar/google/callback`. The exact URI is shown in Settings > Google Calendar. Copy the client ID and secret, then in MetanoiaDocs, **Settings > Google Calendar**: paste them, switch **Enabled** on, save.

## Admin: token key (once)

7. Generate a key and set it in your server's environment (`CALENDAR_TOKEN_KEY` in the `.env` next to `docker-compose.yaml`; the compose file passes it to the server), then recreate the container (`docker compose up -d`):

   ```
   openssl rand -base64 32
   ```

   ```
   CALENDAR_TOKEN_KEY=<the output>
   ```

   It must be standard padded base64 of exactly 32 bytes (what the command prints). Refresh tokens are stored encrypted with it.

**If the key is lost or changed**, every stored connection becomes unreadable. Each one is deleted the first time it is used, and everyone has to connect again (notes pages and tasks are kept). Removing the key hides the feature until it is set again. Keep it with your other secrets.

## Everyone

8. **Settings > Calendar > Connect**. The app is not verified by Google, so Google first shows **"Google hasn't verified this app"**: click **Advanced**, then **Go to <app name> (unsafe)**. Approve the next screen and leave the calendar box ticked. This warning appears once per person.
9. Home shows today's meetings with **Start notes**; **Calendar** in the side menu shows day, week and month. **Disconnect** in Settings > Calendar revokes and deletes the stored token.

**Connected before invites existed?** Those connections are read-only: the calendar still shows, but creating or answering meetings needs one reconnect. The app says so (Calendar page and the meeting card) and links to Settings > Calendar.

## Notes

- Notes pages are private to the person who started them; so are their events.
- **Suggest tasks** on a notes page uses Ask AI, so configure it first (Settings > Ask AI). Nothing is created until the person accepts.
- Edit and cancel work only on meetings the person organises; for the rest they can Accept, Maybe or Decline.
- Troubleshooting: after Connect you land on `/?calendar=error`. `reason=reconsent` means Google sent no refresh token (remove the app at myaccount.google.com/permissions, connect again); `reason=scope` means the calendar box was unticked.
- End-to-end check: `e2e/calendar/run.sh` (uses a Google stub).
