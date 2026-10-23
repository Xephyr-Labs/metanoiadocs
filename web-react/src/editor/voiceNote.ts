// "/voice note": record from the microphone straight into the page.
//
// No block of our own. BlockSuite's attachment block already plays a sound in
// place when it is an audio file shown as an embed (affine-block-attachment's
// embed.js, the 'audio' config), so a voice note is an ordinary attachment
// inserted with embed on — it syncs, exports and survives a reload like any
// other file in the page.
//
// While recording, a small pill sits at the bottom of the window: how long it
// has run, Stop, and Discard (or Esc). Plain DOM rather than a lit element,
// because it is three controls that exist for a minute and then go away.
import { addSiblingAttachmentBlocks } from '@blocksuite/affine/blocks/attachment';
import { MicrophoneIcon } from '@blocksuite/icons/lit';
import { SlashMenuConfigExtension, type SlashMenuConfig } from '@blocksuite/affine-widget-slash-menu';
import { formatElapsed, micErrorMessage, startRecording, type Recording } from '../lib/recorder';

type Std = Parameters<typeof addSiblingAttachmentBlocks>[0];
type Model = Parameters<typeof addSiblingAttachmentBlocks>[2];

/** The one recording in progress, if any — two at once would fight for the mic.
 *  `host` is the editor it was started in, so only that editor's teardown ends it:
 *  a task peek or history preview mounts an editor of its own beside the page's. */
let active: { cancel: () => void; host: Element | null } | null = null;

/** Throw away a recording started in this editor; called as it unmounts. */
export function cancelVoiceNote(root: Element): void {
  if (active && (!active.host || root.contains(active.host))) active.cancel();
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.style.cssText = 'border:0;border-radius:6px;padding:4px 10px;font:inherit;cursor:pointer;background:var(--surface);color:var(--ink)';
  b.addEventListener('click', onClick);
  return b;
}

function recordInto(std: Std, model: Model): void {
  if (active) return;
  const host = (std as unknown as { host?: Element }).host ?? null;
  // Where the caret was, to hand it back when the pill goes.
  const before = document.activeElement as HTMLElement | null;
  const pill = document.createElement('div');
  // A group, not a status region: a live region would read the timer out
  // every second over the person speaking.
  pill.setAttribute('role', 'group');
  pill.setAttribute('aria-label', 'Recording a voice note');
  pill.style.cssText =
    'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:1000;display:flex;align-items:center;gap:8px;' +
    'padding:8px 10px 8px 14px;border-radius:10px;background:var(--canvas);color:var(--ink);font-size:13px;' +
    'box-shadow:0 2px 4px rgba(15,15,15,0.04),0 8px 24px rgba(15,15,15,0.10),0 0 0 1px var(--line)';
  const dot = document.createElement('span');
  dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:var(--danger)';
  const label = document.createElement('span');
  label.style.cssText = 'min-width:44px;font-variant-numeric:tabular-nums;color:var(--muted)';
  label.textContent = 'Starting…';
  label.setAttribute('aria-hidden', 'true');
  pill.append(dot, label);
  document.body.append(pill);

  let rec: Recording | null = null;
  let closed = false;
  // A second Stop click, or the ten-minute limit landing on a click, must not
  // insert the note twice.
  let saving = false;
  // Free the slot — but only if it is still ours: a failed pill lingers to
  // be read while a fresh /voice may already have taken it.
  const release = () => {
    if (active?.cancel === cancel) active = null;
    document.removeEventListener('keydown', onKey, true);
  };
  const close = () => {
    if (closed) return;
    closed = true;
    release();
    if (pill.contains(document.activeElement)) before?.focus?.({ preventScroll: true });
    pill.remove();
  };
  const fail = (message: string) => {
    rec = null;
    // The next /voice may start now; only the message stays a few seconds.
    release();
    if (pill.contains(document.activeElement)) before?.focus?.({ preventScroll: true });
    dot.remove();
    pill.querySelectorAll('button').forEach((b) => b.remove());
    label.textContent = message;
    label.style.color = 'var(--danger-strong)';
    label.removeAttribute('aria-hidden');
    label.setAttribute('role', 'alert');
    setTimeout(close, 4000);
  };
  const cancel = () => {
    rec?.cancel();
    rec = null;
    close();
  };
  const onKey = (e: KeyboardEvent) => {
    // Only an Esc aimed at this page or the pill: one meant for a dialog, a
    // menu or a comment box must reach it and leave the recording alone.
    const target = e.target as Node | null;
    if (e.key !== 'Escape' || !target || !(pill.contains(target) || host?.contains(target))) return;
    e.preventDefault();
    e.stopPropagation();
    cancel();
  };
  const finish = async (file: File) => {
    rec = null;
    if (closed || saving) return;
    saving = true;
    pill.querySelectorAll('button').forEach((b) => b.remove());
    label.textContent = 'Saving…';
    try {
      // embed = true: shown as a player, not as a file card.
      const ids = await addSiblingAttachmentBlocks(std, [file], model, 'after', true);
      if (!ids.length) return fail('That recording is too large to add.');
      if (model.flavour === 'affine:paragraph' && model.text?.length === 0) std.store.deleteBlock(model);
      close();
    } catch {
      fail('Could not add the voice note.');
    }
  };

  active = { cancel, host };
  document.addEventListener('keydown', onKey, true);
  startRecording({
    onTick: (ms) => { label.textContent = formatElapsed(ms); },
    onAutoStop: (file) => void finish(file),
  }).then((r) => {
    if (closed) { r.cancel(); return; }
    rec = r;
    label.textContent = formatElapsed(0);
    const stop = button('Stop', () => { const r2 = rec; if (r2) void r2.stop().then(finish); });
    pill.append(stop, button('Discard', cancel));
    // Keyboard people can reach Stop at once; Esc in the page still discards.
    stop.focus({ preventScroll: true });
  }).catch((e) => fail(micErrorMessage(e)));
}

const voiceNoteSlashMenuConfig: SlashMenuConfig = {
  items: [
    {
      name: 'Voice note',
      description: 'Record audio that plays in the page.',
      icon: MicrophoneIcon(),
      searchAlias: ['audio', 'record', 'mic'],
      // Beside upstream's Attachment (@3) and PDF (@4).
      group: '4_Content & Media@5',
      when: ({ model }) => model.store.schema.flavourSchemaMap.has('affine:attachment'),
      action: ({ std, model }) => recordInto(std as unknown as Std, model as unknown as Model),
    },
  ],
};

export function voiceNoteExtensions() {
  return [SlashMenuConfigExtension('metanoia:voice-note', voiceNoteSlashMenuConfig)];
}
