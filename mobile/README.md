# MetanoiaDocs for Android

A Capacitor app that opens a MetanoiaDocs server full-screen, with push
notifications, the Android back button, and a native status bar.

## How it works

1. **First launch.** The app shows `www/index.html` and asks for the server
   address. It checks that the address really is a MetanoiaDocs server
   (`/health` answers `app: "metanoiadocs"`), then saves it on the phone.
2. **Every launch after that.** `MainActivity` points the WebView at the saved
   server, so the server's own pages load with full access to the native
   plugins. People sign in on the server's normal sign-in page. That page
   shows which server the app is using and a **Change** link back to step 1.
3. **Offline.** If the server can't be reached, `www/error.html` offers
   **Try again** and **Use a different server**.

The web app's side of this lives in `web-react/src/lib/nativeApp.ts`. It does
nothing in a browser.

## Push notifications

Push goes through Firebase Cloud Messaging:

1. After sign-in, the app registers this install's FCM token with the server
   (`POST /api/push/fcm`).
2. The server sends through FCM alongside Web Push (`server/src/fcm.js`).
3. Signing out removes the token again.

The server sends nothing until it is given the Firebase service account, in
one of two ways:

```yaml
environment:
  FCM_SERVICE_ACCOUNT_FILE: /run/secrets/fcm.json   # or FCM_SERVICE_ACCOUNT with the JSON itself
```

## Building

You need:
- a JDK 21 with `javac` (a JRE is not enough)
- the Android SDK with platform 36
- `android/app/google-services.json`, from the Firebase project
- `android/keystore.properties`, which points at the release keystore. Keep the
  keystore safe: every future version must be signed with the same key, or
  phones will refuse the update.

```bash
npm install
npm run apk        # → android/app/build/outputs/apk/release/app-release.apk
```

Or, to run the steps yourself:

```bash
npx cap sync android
cd android && ./gradlew assembleRelease
```
