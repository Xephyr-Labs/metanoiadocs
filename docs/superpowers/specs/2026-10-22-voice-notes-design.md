# Voice notes in comments and pages — design

Date: 2026-10-22. Status: proposed.

## What

Record a voice note in the browser and drop it into:

1. **A comment or reply**, on a page or on a task. A comment can be voice only, text only, or both.
2. **A page**, using a `/voice note` item in the slash menu. It lands as an attachment block that plays in place.

Every voice note plays back with the browser's own audio player.

**Out of scope:** transcription (not wanted), voice notes from guests on public links, waveform or speed controls, and attaching arbitrary files to comments. The column added below can hold any file, but the UI only adds voice.

## What already exists (verified in code)

- `PUT/GET /api/blob/:key` (`server/src/index.js:2325`, `:2340`) stores bytes in Postgres. Uploads are capped at 25 MB. Audio types `mpeg|mp4|ogg|wav|webm` are served inline with byte ranges, so seeking works.
- `uploadFile()` and `StoredFile` (`web-react/src/lib/uploads.ts`) handle the upload: sha256 key, then the PUT.
- `Attachments` (`web-react/src/components/ui/Attachments.tsx`) already shows an `<audio controls>` player for audio files.
- `coerceFiles()` (`server/src/props.js`) validates a list of `{key,name,mime,size}`, at most 20 entries. It's already used for `tasks.attachments`.
- The BlockSuite attachment block already has an `audio` embed config (`@blocksuite/affine-block-attachment/dist/embed.js:152`). It renders `<audio controls>` when the block's `type` starts with `audio/` and `embed: true`. **So a page needs no custom block.**

## Gaps found

- **Mime parameters break playback.** `MediaRecorder` reports types like `audio/webm;codecs=opus`. The inline check on the server is anchored (`^…$`), so the file would be served as an octet-stream download and never play. Fix: strip the parameters when the blob is stored. That covers every uploader, including BlockSuite's `HttpBlobSource`.
- **Chrome's webm recordings have no duration.** The `<audio>` element reports `Infinity`, and the scrubber can't seek until the clip has played once. Fix: one listener on `document` for `loadedmetadata` (capture phase). It forces a seek to the end, then back to the start. This covers both the comment players and BlockSuite's embed.
- **Comments can't carry files.** Add a column.
- **Android needs microphone permission.** The Capacitor manifest has only `INTERNET` and `POST_NOTIFICATIONS`.

## Design

**Recording**: `web-react/src/lib/recorder.ts`
- Container type, in order of preference: `audio/webm`, then `audio/mp4` (Safari). The first one `MediaRecorder.isTypeSupported` accepts wins.
- `audioBitsPerSecond: 32000`. Speech at that rate is about 240 KB a minute.
- Recording stops by itself at **10 minutes**, about 2.4 MB.
- Stopping or cancelling releases every microphone track, so the browser's recording indicator goes off.
- The file is named `Voice note YYYY-MM-DD HH.MM.<ext>`.

**Comment UI**: `web-react/src/components/ui/VoiceNoteButton.tsx`
- A mic `IconButton` sits beside Send. Pressing it records: a red dot, an elapsed time, a Stop button and a Cancel button.
- Stop uploads the note and shows it as a pending player above the text box, with a remove ×.
- Send posts the text and the note together. Enter with an empty box still sends when a note is pending.
- It appears in the page comment composer and the task comment composer, and in the reply composers of both.

**Comments storage**
- New column: `comments.attachments JSONB NOT NULL DEFAULT '[]'`.
- Both POST routes take `attachments` and validate it with `coerceFiles`. Both GET routes return it.
- A comment has to carry text or a file. Otherwise the route returns `400 empty comment`, as today.
- When the body is empty, notifications, email and webhooks use the text `🎤 Voice note`, so an inbox row is never blank.
- Guest comment routes stay as they are. Guests can't record.

**Page**: `web-react/src/editor/voiceNote.ts`
- A slash item named `Voice note`, with aliases `audio`, `record` and `mic`. It shows a small fixed "recording" pill drawn with plain DOM, containing a timer, Stop and Cancel.
- Stop stores the bytes with `std.store.blobSync.set(file)`, which goes through the existing `HttpBlobSource`. It then inserts an `affine:attachment` block `{ name, size, type, sourceId, embed: true }` after the current block, replacing that block if it's an empty paragraph.

## Ideas from Macro (macro-inc/macro, AGPL-3.0)

Macro's licence is AGPL, so we take ideas only and no code. I checked each idea against the codebase:

| Macro idea | metanoiadocs today | Verdict |
|---|---|---|
| Two-way @links between objects | Done: `LinkedPages.tsx` shows both directions, and tasks have backlinks (`props-routes.js:234`) | Nothing to do |
| Cmd+K jump to anything | Done: `CommandPalette.tsx` covers pages, tasks, databases and commands | Nothing to do. Add people only if someone asks |
| Version history with fork | Done: `HistoryView.tsx` has restore in place and restore as a copy | Skip the scrubber slider. The list already does the job |
| Turn `- [ ]` bullets or `/task` into linked tasks | **Missing** | **Worth building next.** Small: a slash item or a to-do toolbar action that calls the existing create-task API and replaces the line with a task link. Separate plan |
| Nightly team-memory digest for agents | MCP already gives agents live docs and tasks | Skip. A nightly copy is staler than what MCP already serves |
| Recorded and transcribed calls | Mattermost notetaker covers calls. Transcription isn't wanted | Skip |
| Email, CRM, chat, desktop app | Mattermost and others cover these | Skip. Out of product scope |

## Follow-ups (not in this work)

- `PUT /api/blob/:key` doesn't check that the key matches the sha256 of the bytes. Any signed-in user could plant bytes under a key they predict. Small fix, but it's its own change.
- `- [ ]` to task (above).
