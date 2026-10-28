# Google Calendar setup

Lets each person see today's meetings on Home and start private notes for them. Read-only: MetanoiaDocs never writes to Google. Scope requested: `openid email https://www.googleapis.com/auth/calendar.events.readonly`.

The feature stays hidden until both the admin settings (steps 1-5) and the server key (step 6) are in place.

## Admin: Google Cloud (once)

1. In the [Google Cloud console](https://console.cloud.google.com/) create or pick a project in your Workspace organisation.
2. **APIs & Services > Library**: enable **Google Calendar API**.
3. **APIs & Services > OAuth consent screen**: user type **Internal** (only people in your Workspace can connect; no Google verification needed). Add the scope `.../auth/calendar.events.readonly` (plus `openid` and `email`).
4. **APIs & Services > Credentials > Create credentials > OAuth client ID**: type **Web application**. Under **Authorized redirect URIs** add `${BASE_URL}/api/calendar/google/callback`, e.g. `https://docs.example.com/api/calendar/google/callback`. The exact URI is shown in Settings > Google Calendar. Copy the client ID and secret.
5. In MetanoiaDocs, **Settings > Google Calendar**: paste the client ID and secret, switch **Enabled** on, save.

## Admin: token key (once)

6. Generate a key and set it in your server's environment (the compose file's `environment:` for the server service), then restart the container:

   ```
   openssl rand -base64 32
   ```

   ```
   CALENDAR_TOKEN_KEY: <the output>
   ```

   It must be standard padded base64 of exactly 32 bytes (what the command prints). Refresh tokens are stored encrypted with it.

**If the key is lost or changed**, stored tokens can no longer be read: everyone sees "Reconnect your calendar" and must connect again (nothing else is lost). Keep it with your other secrets.

## Everyone

7. **Settings > Calendar > Connect**, then approve on Google's screen (leave the calendar box ticked). Home now shows today's meetings with **Start notes**. **Disconnect** in the same place revokes and deletes the stored token.

## Notes

- Notes pages are private to the person who started them; so are their events.
- **Suggest tasks** on a notes page uses Ask AI, so configure it first (Settings > Ask AI). Nothing is created until the person accepts.
- Troubleshooting: after Connect you land on `/?calendar=error`. `reason=reconsent` means Google sent no refresh token (remove the app at myaccount.google.com/permissions, connect again); `reason=scope` means the calendar box was unticked.
- End-to-end check: `e2e/calendar/run.sh` (uses a Google stub).
