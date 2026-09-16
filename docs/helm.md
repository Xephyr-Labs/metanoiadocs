# Deploy on Kubernetes

The chart is in [`charts/metanoiadocs`](../charts/metanoiadocs). It installs one
Deployment, one Service, and — unless you point it at a database you already run
— one Postgres StatefulSet with a volume.

## Install

```bash
git clone https://github.com/Xephyr-Labs/metanoiadocs.git
cd metanoiadocs

helm install docs charts/metanoiadocs \
  --namespace metanoiadocs --create-namespace \
  --set baseUrl=https://docs.example.com \
  --set ingress.enabled=true \
  --set ingress.host=docs.example.com \
  --set ingress.tls.enabled=true
```

`baseUrl` is the one value you must get right: emailed sign-in links and Web
Push notifications are both built from it, so a value that does not match the
address people actually type produces links that go nowhere. The chart warns
after install if it disagrees with the ingress host.

No ingress yet? Leave it off and look at it through a port-forward:

```bash
kubectl -n metanoiadocs port-forward svc/docs-metanoiadocs 8092:80
```

## The database

The bundled Postgres is fine for a small team and needs no configuration — the
chart generates a password on first install and reads the same one back on every
upgrade, so a `helm upgrade` cannot lock the app out of its own database.

For anything you would be upset to lose, use a managed Postgres instead:

```bash
helm upgrade docs charts/metanoiadocs \
  --set postgres.enabled=false \
  --set externalDatabase.existingSecret=my-db-secret \
  --set externalDatabase.existingSecretKey=DATABASE_URL
```

`externalDatabase.url` takes the connection string directly if you would rather
not manage a secret, but it then lives in your values file and in
`helm get values` — the secret reference is the better habit.

The schema creates and migrates itself on every boot. There is no migration job
to run, before or after an upgrade.

## Email

Out of the box `mail.devMode` is `true`, which prints sign-in and invite links to
the pod log instead of emailing them. That makes the whole flow testable with no
SMTP credentials — and it means anyone who can read the log can sign in as
anyone, so turn it off before real people use the instance:

```yaml
mail:
  devMode: false
  host: smtp.example.com
  port: 587
  user: apikey
  existingSecret: metanoiadocs-smtp   # key: SMTP_PASS
  from: MetanoiaDocs <docs@example.com>
```

## Skipping the setup screen

By default the first visit shows a setup screen and the account created there is
the admin. For an unattended install, set `admin.email` and `admin.password`
instead — they apply only while the instance has no accounts at all, so they
cannot be used to add a second admin later.

## Everything else

`values.yaml` is commented, and `extraEnv` passes through anything from
[`.env.example`](../.env.example) that has no value of its own yet:

```yaml
extraEnv:
  - name: AGENT_RUN_STALE_MIN
    value: "45"
```

## Notes on shape

- **One replica, `Recreate` strategy.** The `/sync` WebSocket carries live Yjs
  document state and the schema migrates itself on boot; two versions of the
  server sharing one database mid-rollout is not worth supporting for a
  workspace that fits on one pod. Raising `replicaCount` is not supported yet.
- **One ingress rule for everything.** The SPA, the REST API and `/sync` are one
  origin on one port by design. Splitting them across paths is how the editor
  ends up unable to reach `/sync`.
- **Readiness is a real check.** `/health` round-trips the database, so a pod
  reports ready when it can serve a request, not when the process has started.
