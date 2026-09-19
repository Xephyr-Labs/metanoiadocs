# Browser notifications: what actually works, proved

A colleague reported that browser notifications "do not work". The feature has
three independent layers and the phrase covers all of them, so this spec pins
down each one with evidence rather than reasoning, names the defects the
evidence exposes, and says what the fix has to change.

Everything below was measured on 2026-09-19 against the code at `d2f9afd` and
against production (`docs.xephyrlabs.com`, `sha-826a1ba`).

## The three layers

| Layer | What raises the alert | Works when | Needs |
|---|---|---|---|
| L1 — foreground | `new Notification()` from the open tab, driven by a 60s inbox poll (`useDesktopNotifications`) | a tab is open | permission + the per-device `mn-desktop-notify` flag |
| L2 — subscription | `pushManager.subscribe()`, endpoint stored in `push_subscriptions` | once per browser profile | a working push service |
| L3 — delivery | `web-push` → the browser vendor's push service → `push-sw.js` | app closed, browser running | a row in `push_subscriptions` |

A failure in any one of them reads identically to the person: nothing happens.

## Evidence

### L3 delivery is sound — proved end to end

The real `web-react/public/push-sw.js` was served under a worker that only does
`importScripts('/push-sw.js')` (the same thing `vite.config.ts` asks Workbox to
do), subscribed from a real browser against a real push service, and sent the
exact payload `server/src/push.js` builds:

```
[subscribed] {"endpoint":"https://updates.push.services.mozilla.com/wpush/v2/gAAAAA…"}
[send] status 201
[shown] [{"title":"Rima assigned you a task","body":"Ship the notification spec",
          "tag":"notif-row-id-1","icon":"…/pwa-192.png","silent":false,
          "requireInteraction":false,"data":{"url":"/d/abc"}}]
```

VAPID signing, payload encryption, the service worker's `push` handler and the
notification it shows are all correct. **L3 is not the bug.**

The harness is kept at `docs/superpowers/specs/probes/push-e2e/` so the claim
can be re-checked rather than believed.

One honest caveat about re-running it: that pass was recorded at 00:05 on
2026-09-19. Every run on the same machine afterwards stalls inside
`pushManager.subscribe()` and never settles — the harness reports its steps, and
they stop at `subscribing`. That is not a regression in this code; it is the
browser's own push service declining to hand out another subscription from this
host, and it is precisely the second failure mode the fix has to report, because
an unbounded `await` on that call is what left the Settings switch spinning. A
push service that refuses (Brave) and one that never answers (here) are both
"no background alerts", and both used to read as success.

### L2 is where it dies, and it dies silently

`pushManager.subscribe()` in Brave 147, permission already granted, worker
registered and ready:

```
{ "steps": ["registered", "ready"],
  "result": "REJECTED AbortError: Registration failed - push service error",
  "permission": "granted" }
```

Brave ships with *Use Google services for push messaging* off, so there is no
push service to register with. The same rejection is what any Chromium build
without a push service gives — including the one this repo's own notes say
"just hangs" under headless Chrome.

`lib/push.ts` swallows it:

```ts
if (on) {
  await subscribePush().catch(() => false);   // enableAlerts
}
```

So the switch turns on, reports success, and the device is never registered.
Nothing in the app ever says so. This is the defect: **not that some browsers
cannot do push, but that the app claims they can.**

### Production agrees

```
sajjad.riaj        wns2-by3p.notify.windows.com   2026-09-13   ← Edge on Windows
farhanajanchal     fcm.googleapis.com             2026-09-17
riyashat.mozaher   fcm.googleapis.com             2026-09-17
mojahad.sabbir     fcm.googleapis.com             2026-09-17
farhanajanchal     fcm.googleapis.com             2026-09-17
farhanajanchal     fcm.googleapis.com             2026-09-19
```

Six subscriptions across **four** of fifteen users. Notifications written in the
last two days went to `arafat.dayan`, `shfnysr` and others who hold no
subscription at all — for them L3 has nothing to send to, and the app has never
told them. The server log carries no `[push] send failed` line in 72 hours, so
the sends that do happen are being accepted.

A Chrome or Edge user who "gets no notifications" is therefore almost certainly
in one of two states, and today **neither is visible from inside the app**:

1. No subscription for the browser they are sitting in (the flag is per-device;
   a second machine or a new profile is silent again).
2. A subscription that exists but whose `mn-desktop-notify` flag was never set,
   so L1 is off too.

### Sound: we do deliver it, and the OS owns it

The delivered notification came back `silent: false`, which is the default and
means the platform plays its own notification sound. Neither `raise()` nor
`push-sw.js` sets `silent`, so nothing in this codebase suppresses it.

Two limits worth writing down, because they are platform facts and not bugs to
be fixed here:

- **A web notification cannot carry a custom sound.** The `sound` option was
  dropped from the spec and is implemented nowhere. What plays is the OS's
  notification sound, subject to Focus Assist, Do Not Disturb, and per-app
  sound settings.
- **A notification that replaces one with the same `tag` is silent** unless
  `renotify: true`. That is the behaviour we want: L1's poll and L3's push both
  tag by the notification row id, so a device that gets both shows one alert
  with one sound rather than two.

If an audible cue is wanted even where the OS is quiet, the only place it can be
added is L1 — an `Audio` played by the open tab. That is a product decision, not
a defect, and it is out of scope here.

### A smaller one: the foreground icon is a 404

`raise()` asks for `icon: '/favicon.svg'`. There is no `favicon.svg` in
`web-react/public/`, in `index.html`, or in `dist/`. Foreground alerts draw with
no icon while pushed ones — which correctly use `/pwa-192.png` — draw with one.

## Defects

| # | Defect | Effect | Severity |
|---|---|---|---|
| D1 | `enableAlerts` discards the reason `subscribePush` failed | the switch reports success on a device that will never get a background alert | high |
| D2 | Nothing shows whether *this device* is registered | "it does not work" is unanswerable without a psql prompt | high |
| D3 | `pushManager.subscribe()` is awaited with no timeout | where the call hangs rather than rejects, the switch spins and never settles | medium |
| D4 | No way to make a notification happen on demand | a report cannot be reproduced by the person making it | medium |
| D5 | `icon: '/favicon.svg'` does not exist | foreground alerts are iconless | low |

`/api/push/devices` already returns exactly what D2 needs and no screen draws it.

## The fix

1. **`subscribePush()` returns a reason, not a boolean.**
   `{ ok: true } | { ok: false; reason: 'unsupported' | 'denied' | 'no-key' | 'no-worker' | 'blocked' | 'timeout'; detail?: string }`.
   Classifying a `DOMException` into a reason is pure and gets a unit test.
2. **`enableAlerts()` passes that result up** instead of `.catch(() => false)`.
3. **Settings tells the truth about this device.** It re-runs `subscribePush()`
   on open — an upsert, so it costs one row write and heals a subscription the
   server lost — and `alertsDescription()` turns the result into one of three
   lines: on and registered, on but foreground-only *with the reason*, or off.
4. **`pushManager.subscribe()` races a timeout**, the same way `workerReady`
   already does, so the switch always settles.
5. **A "Send a test notification" button** next to the switch, posting to a new
   `POST /api/push/test` which calls `sendPush` for the caller. It exercises the
   whole chain — subscription row, VAPID, push service, service worker — and
   answers "is it me or is it the app?" in one click.
6. **`icon: '/pwa-192.png'`** in `raise()`, matching the worker.

Explicitly not changed: the delivery path (proved correct), the `tag`/`renotify`
behaviour (deliberate), and the opt-in nature of the switch.

## What keeps this true

- `web-react/src/lib/push.test.ts` — the error-to-reason classifier and the
  status text for each state.
- `server/src/push-rules.test.js` — unchanged, still covers `isGone`/`linkFor`.
- `docs/superpowers/specs/probes/push-e2e/` — the end-to-end harness above.
  Run it after touching `push-sw.js`, the payload shape, or the VAPID handling;
  it is the only check that crosses a real push service.
- The browser probe in the same directory reports whether the browser in front
  of you can subscribe at all, which is the first question to ask when the next
  report arrives.
