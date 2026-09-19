# Push probes

Two checks for the one path unit tests cannot reach: a real browser talking to a
real push service. They back the claims in
`../2026-09-19-notification-delivery-proof.md`.

## `can-subscribe.mjs` — can this browser subscribe at all?

```bash
node can-subscribe.mjs                 # Brave
node can-subscribe.mjs google-chrome   # anything Chromium, by path or name
```

No dependencies. It serves its own page, generates a throwaway VAPID public key
and drives the browser over CDP with notifications pre-granted. A browser with
no push service answers:

```
"result": "REJECTED AbortError: Registration failed - push service error"
```

which is what Brave 147 gives out of the box, and what the app must report as
"alerts only while a tab is open" rather than as success.

## `serve.mjs` — does a push actually arrive and draw?

Serves the app's **real** `push-sw.js` under a worker that only does
`importScripts('/push-sw.js')` — the same thing `vite.config.ts` asks Workbox to
do — subscribes, and sends the exact payload `server/src/push.js` builds.

```bash
npm install                            # web-push
node serve.mjs &
firefox -headless -profile <a profile allowing notifications> http://127.0.0.1:8099/
```

Firefox because it has a push service on Linux where Chromium builds often do
not; its profile needs `user_pref("permissions.default.desktop-notification", 1)`
and, on a headless box, `xvfb-run`. A pass looks like:

```
[subscribed] {"endpoint":"https://updates.push.services.mozilla.com/wpush/v2/…"}
[send] status 201
[shown] [{"title":"Rima assigned you a task","body":"Ship the notification spec",
          "tag":"notif-row-id-1","silent":false,"data":{"url":"/d/abc"}}]
```

Run it after touching `push-sw.js`, the payload shape in `push.js`, or the VAPID
handling. `silent: false` is the sound: the OS plays its own, and a web
notification cannot carry a custom one.

The page reports each step as it passes it, so a run that produces

```
[step] "registered" / "worker ready" / "have key" / "subscribing"
```

and then nothing has hung inside `pushManager.subscribe()` — the push service is
not answering this host. That is an environment result, not a code one, and it
is the same condition the app now reports as "only while a tab is open". Two
things make it likelier: a cold profile, and having taken several subscriptions
from the same address already.
