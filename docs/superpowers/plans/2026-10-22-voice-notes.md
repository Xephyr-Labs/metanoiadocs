# Voice Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record voice notes in the browser and play them back, in page comments, task comments and replies, and as a block inside a page.

**Architecture:** One shared recorder module (`MediaRecorder`) produces a `File`. Comments upload it with the existing `uploadFile()` and keep it in a new `comments.attachments` JSONB column, validated by the existing `coerceFiles()`. Pages store it with BlockSuite's `blobSync` and insert a stock `affine:attachment` block with `embed: true`, which BlockSuite's own audio embed config already plays. No custom block.

**Tech Stack:** Express + pg (`node --test`), React + Vite (`vitest`), BlockSuite 0.22.4, Capacitor Android.

**Spec:** `docs/superpowers/specs/2026-10-22-voice-notes-design.md`

## Global Constraints

- Container preference: `audio/webm`, then `audio/mp4`. Bitrate `audioBitsPerSecond: 32000`. Auto-stop at `600000` ms (10 min).
- File name: `Voice note YYYY-MM-DD HH.MM.webm` (or `.m4a` for `audio/mp4`).
- Stored mime never carries parameters (`audio/webm`, not `audio/webm;codecs=opus`).
- A comment needs non-empty text or at least one attachment. Otherwise `400 { error: 'empty comment' }`.
- Fan-out text for a comment with an empty body: `🎤 Voice note`.
- No transcription. No guest recording. Guest routes are untouched.
- No new dependencies.
- rtk mangles `npm run` and `npx`. Call the binaries directly: `server/node_modules/.bin/…`, `web-react/node_modules/.bin/vitest`, `web-react/node_modules/.bin/tsc`.
- Work on a branch from `main` (`feat/voice-notes`). Never push to `main`.

## Review Focus

1. **Microphone denied or missing:** `getUserMedia` rejects with `NotAllowedError` or `NotFoundError`. Show the readable error `Microphone is blocked — allow it in the browser's site settings.` or `No microphone found.`, and leave the composer usable. Test in Task 3 (`micErrorMessage`).
2. **Leaving mid-recording:** the panel unmounts or the page changes while recording. Every track must stop, so the mic indicator goes off and no upload happens. Covered by the unmount cleanup in Task 4 and Task 5; checked in Task 7.
3. **Voice-only comment in the inbox or email:** the body is empty. Fan-out must say `🎤 Voice note`, not a blank line. Test in Task 2 (`commentInput().notifyText`).
4. **Chrome webm with no duration:** the scrubber shows `Infinity` and can't seek. The global `loadedmetadata` fix in Task 3, checked in Task 7.
5. **Older comment rows and other readers:** rows from before the column read as `[]` (column default), and an edit through PATCH keeps the attachments, because PATCH doesn't touch the column. Checked in Task 7.

---

### Task 1: Store blob mime without parameters

**Files:**
- Create: `server/src/media.js`
- Create: `server/src/media.test.js`
- Modify: `server/src/index.js:2325-2333` (`PUT /api/blob/:key`)

**Interfaces:**
- Produces: `baseMime(raw: string | undefined) => string`. Lower-cased, parameters stripped, defaults to `application/octet-stream`.

- [ ] **Step 1: Write the failing test** in `server/src/media.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { baseMime } from './media.js';

test('drops codec parameters a recorder adds', () => {
  assert.equal(baseMime('audio/webm;codecs=opus'), 'audio/webm');
  assert.equal(baseMime('Audio/MP4; codecs="mp4a.40.2"'), 'audio/mp4');
});
test('missing or blank is an octet-stream', () => {
  assert.equal(baseMime(undefined), 'application/octet-stream');
  assert.equal(baseMime('  '), 'application/octet-stream');
});
```

- [ ] **Step 2: Run** `cd server && node --test src/media.test.js`. Expected: FAIL, cannot find module.
- [ ] **Step 3: Implement** `baseMime` in `server/src/media.js`, with a comment saying why: the inline-media check in `GET /api/blob` is anchored. In the PUT route, replace `req.headers['content-type'] || 'application/octet-stream'` with `baseMime(req.headers['content-type'])`.
- [ ] **Step 4: Run** `cd server && node --test src/media.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(blob): store mime without codec parameters so recorded audio plays inline`

### Task 2: Comments carry attachments

**Files:**
- Create: `server/src/comment-input.js`
- Create: `server/src/comment-input.test.js`
- Modify: `server/src/db.js` (after the `anchor_end` ALTER near `:555`)
- Modify: `server/src/index.js:2605-2682` (page comments GET and POST)
- Modify: `server/src/task-comments.js:147-230` (`insertTaskComment`, task GET and POST)

**Interfaces:**
- Consumes: `coerceFiles(value) => StoredFile[] | undefined` from `server/src/props.js`.
- Produces: `commentInput(raw: { body?: unknown, attachments?: unknown }) => { body: string, attachments: StoredFile[], notifyText: string } | { error: string }`. `body` is trimmed and cut to 4000 characters. `notifyText` is `body || '🎤 Voice note'`.
- Produces: API rows gain `attachments: StoredFile[]`. The POST bodies accept `attachments`.

- [ ] **Step 1: Write the failing tests** in `server/src/comment-input.test.js`

```js
const note = { key: 'a'.repeat(64), name: 'Voice note 2026-10-22 14.03.webm', mime: 'audio/webm', size: 1200 };
test('text only', () => assert.deepEqual(commentInput({ body: ' hi ' }), { body: 'hi', attachments: [], notifyText: 'hi' }));
test('voice only reads as a voice note in notifications', () => {
  const out = commentInput({ body: '', attachments: [note] });
  assert.equal(out.body, ''); assert.equal(out.attachments.length, 1); assert.equal(out.notifyText, '🎤 Voice note');
});
test('neither is empty', () => assert.deepEqual(commentInput({ body: '  ', attachments: [] }), { error: 'empty comment' }));
test('a malformed file refuses the whole comment', () =>
  assert.deepEqual(commentInput({ body: 'x', attachments: [{ key: '../etc' }] }), { error: 'bad attachments' }));
test('body capped at 4000', () => assert.equal(commentInput({ body: 'x'.repeat(5000) }).body.length, 4000));
```

- [ ] **Step 2: Run** `cd server && node --test src/comment-input.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `commentInput` in `server/src/comment-input.js`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Schema.** In `db.js`, add `ALTER TABLE comments ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]';` with a one-line comment.
- [ ] **Step 6: Page routes.**
  - GET adds `c.attachments` to the select.
  - POST, for a non-suggestion: run `commentInput(req.body)`. On `error`, return 400 with it. Insert `attachments` as `JSON.stringify(...)`.
  - The suggestion path keeps its own `body` rule and inserts `'[]'`.
  - Pass `notifyText` instead of `body` to `createCommentNotifications`. `emit('comment.created', …)` gets `body` plus `attachments`.
  - The task-thread reply branch passes `attachments` on to `insertTaskComment`.
- [ ] **Step 7: Task routes.**
  - `insertTaskComment({ task, body, attachments = [], user, parentId })` inserts the column and calls `notify` with `body || '🎤 Voice note'`.
  - The task POST uses `commentInput` and returns `attachments` in its response row.
  - The task GET selects `c.attachments`.
- [ ] **Step 8: Run** `cd server && node --test src/`. Expected: all pass, `comment-input` and `task-comments` included.
- [ ] **Step 9: Commit** `feat(comments): comments can carry attached files`

### Task 3: Recorder module and webm duration fix

**Files:**
- Create: `web-react/src/lib/recorder.ts`
- Create: `web-react/src/lib/recorder.test.ts`
- Modify: `web-react/src/main.tsx` (call `installAudioDurationFix()` once at startup)

**Interfaces:**
- Produces:
  - `pickMime(isSupported: (t: string) => boolean) => 'audio/webm' | 'audio/mp4' | ''`
  - `voiceNoteName(at: Date, mime: string) => string`, giving `.webm`, or `.m4a` for `audio/mp4`
  - `micErrorMessage(err: unknown) => string`
  - `MAX_VOICE_MS = 600000`
  - `startRecording(opts?: { onTick?: (ms: number) => void; onAutoStop?: (file: File) => void }) => Promise<Recording>`
  - `interface Recording { stop(): Promise<File>; cancel(): void }`. The `File` has a mime without parameters.
  - `installAudioDurationFix(): void`

- [ ] **Step 1: Write the failing tests** in `recorder.test.ts`

```ts
it('prefers webm, falls back to mp4, else none', () => {
  expect(pickMime(() => true)).toBe('audio/webm');
  expect(pickMime((t) => t === 'audio/mp4')).toBe('audio/mp4');
  expect(pickMime(() => false)).toBe('');
});
it('names a note by local time', () => {
  expect(voiceNoteName(new Date(2026, 9, 22, 14, 3), 'audio/webm')).toBe('Voice note 2026-10-22 14.03.webm');
  expect(voiceNoteName(new Date(2026, 9, 22, 9, 5), 'audio/mp4')).toBe('Voice note 2026-10-22 09.05.m4a');
});
it('explains mic failures', () => {
  expect(micErrorMessage(new DOMException('', 'NotAllowedError'))).toBe("Microphone is blocked — allow it in the browser's site settings.");
  expect(micErrorMessage(new DOMException('', 'NotFoundError'))).toBe('No microphone found.');
  expect(micErrorMessage(new Error('x'))).toBe('Could not start recording.');
});
```

- [ ] **Step 2: Run** `cd web-react && ./node_modules/.bin/vitest run src/lib/recorder.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `startRecording` calls `getUserMedia({ audio: true })` and creates `new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 })`, collecting chunks. It ticks every 250 ms and auto-stops at `MAX_VOICE_MS`, which calls `onAutoStop`.
  - `stop` and `cancel` both call `stream.getTracks().forEach(t => t.stop())`.
  - With no supported mime it throws `Recording isn't supported in this browser.`
  - `installAudioDurationFix` adds `document.addEventListener('loadedmetadata', fn, true)`. For an `HTMLAudioElement` whose `duration === Infinity`, it sets `currentTime = 1e101`, then on `durationchange` (once) sets `currentTime = 0`. Add the comment `// ponytail: Chrome's MediaRecorder webm has no duration header; seek-to-end makes it compute one. Replace if we ever post-process recordings.`
- [ ] **Step 4: Run** the vitest command again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(voice): shared browser recorder`

### Task 4: Voice notes in comment and reply composers

**Files:**
- Create: `web-react/src/components/ui/VoiceNoteButton.tsx`
- Modify: `web-react/src/lib/docsApi.ts:134` (`CommentRow.attachments?: StoredFile[]`), `:473` (`addComment` opts `attachments?: StoredFile[]`)
- Modify: `web-react/src/lib/tasksApi.ts:496` (`TaskComment.attachments?: StoredFile[]`), `:589` (`addComment` body `attachments?`)
- Modify: `web-react/src/components/panel/CommentsTab.tsx` (`add`, `sendReply`, comment body render near `:207`, composers near `:433` and `:506`)
- Modify: `web-react/src/components/project/TaskComments.tsx` (`send`, `sendReply`, body render near `:260`, composers near `:305` and `:331`)

**Interfaces:**
- Consumes: `startRecording`, `voiceNoteName`, `micErrorMessage` (Task 3); `uploadFile`, `StoredFile` (`lib/uploads.ts`); `Attachments` (`components/ui/Attachments.tsx`).
- Produces: `<VoiceNoteButton onRecorded={(f: StoredFile) => void} disabled?: boolean />`. It is either idle (mic icon) or recording (red dot, `m:ss`, Stop, Cancel), or uploading (spinner). It shows its error inline, as a `text-2xs` line. It cancels any recording on unmount.

- [ ] **Step 1:** Build `VoiceNoteButton` with the existing `IconButton` and lucide `Mic`, `Square`, `X`, `Loader2`. Tokens only, no raw colours. The recording dot uses the danger token from `index.css`.
- [ ] **Step 2:** In each composer, keep `pending: StoredFile | null` beside the draft.
  - Render `<Attachments files={[pending]} onChange={(n) => setPending(n[0] ?? null)} compact />` above the box when set.
  - The send functions allow an empty body when `pending` is set, pass `attachments: pending ? [pending] : []`, and clear `pending` on success.
  - Place `VoiceNoteButton` left of Send. Hide it in suggestion mode.
- [ ] **Step 3:** Under each comment body, render `c.attachments?.length ? <Attachments files={c.attachments} onChange={() => {}} readOnly compact /> : null`. Comments with no body still show their header.
- [ ] **Step 4: Run** `cd web-react && ./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/vitest run`. Expected: no type errors, all tests pass.
- [ ] **Step 5: Commit** `feat(comments): record voice notes in comments and replies`

### Task 5: `/voice note` in pages

**Files:**
- Create: `web-react/src/editor/voiceNote.ts`
- Modify: `web-react/src/editor/mountEditor.ts` (import, and add `...voiceNoteExtensions()` next to `...calloutExtensions()` near `:543`)

**Interfaces:**
- Consumes: `startRecording`, `voiceNoteName`, `micErrorMessage` (Task 3); `SlashMenuConfigExtension` (pattern in `editor/callout.ts:142-158`); `std.store.blobSync.set(blob): Promise<string>`.
- Produces: `voiceNoteExtensions()`, returning the slash-menu extension array.

- [ ] **Step 1:** Add the slash item: `name: 'Voice note'`, `description: 'Record audio that plays in the page.'`, `searchAlias: ['audio', 'record', 'mic']`, `group: '4_Content & Media@9'`. Check the group key against the upstream attachment item in `affine-block-attachment/dist/configs/slash-menu.js`, and put it next to that item.
- [ ] **Step 2:** The action calls `startRecording` and shows a fixed pill at the bottom centre of the editor, built with plain DOM and project tokens via CSS variables. The pill has a red dot, `m:ss`, Stop and Cancel. Esc means Cancel.
  - On Stop: `const sourceId = await std.store.blobSync.set(file)`, then `store.addSiblingBlocks(model, [{ flavour: 'affine:attachment', name: file.name, size: file.size, type: file.type, sourceId, embed: true }])`. If `model` is an empty `affine:paragraph`, delete it.
  - Errors from `micErrorMessage` show in the pill for 4 s, then the pill removes itself.
  - Return a disposer that cancels when the editor unmounts. Hook it into the existing teardown near `mountEditor.ts:792`.
- [ ] **Step 3: Run** `cd web-react && ./node_modules/.bin/tsc --noEmit -p .`. Expected: clean.
- [ ] **Step 4: Commit** `feat(editor): /voice note records audio into the page`

### Task 6: Android microphone permission

**Files:**
- Modify: `mobile/android/app/src/main/AndroidManifest.xml:54`

- [ ] **Step 1:** Add `<uses-permission android:name="android.permission.RECORD_AUDIO" />` and `<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />` after `POST_NOTIFICATIONS`. Capacitor's `BridgeWebChromeClient` turns a WebView `getUserMedia` call into the runtime prompt.
- [ ] **Step 2: Commit** `feat(android): allow the microphone for voice notes`

### Task 7: End-to-end check in the real app

- [ ] **Step 1:** Run the dev stack, then open Chromium through Playwright with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`, which gives a fake mic and auto-allows it.
- [ ] **Step 2:** Record a voice-only page comment, a reply with text and voice, and a task comment. Reload. Each one plays, and the scrubber seeks before the first play (Review Focus 4).
- [ ] **Step 3:** Type `/voice note` in a page, record and stop. The block plays, survives a reload, and plays for a second signed-in user and on a public share link.
- [ ] **Step 4:** Start recording, then close the comments panel. In devtools, `navigator.mediaDevices` shows no live track, and no PUT `/api/blob` fired (Review Focus 2).
- [ ] **Step 5:** Edit the text of a voice comment. The note is still attached after a reload (Review Focus 5). Check the inbox row for the voice-only comment reads `🎤 Voice note` (Review Focus 3).
- [ ] **Step 6:** Block the mic in site settings and press record. The exact blocked-mic message from Task 3 appears (Review Focus 1).
