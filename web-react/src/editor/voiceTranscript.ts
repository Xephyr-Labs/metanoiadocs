import { ActionPlacement, ToolbarModuleExtension, type ToolbarContext } from '@blocksuite/affine/shared/services';
import { BlockFlavourIdentifier } from '@blocksuite/affine/std';
import { TextIcon } from '@blocksuite/icons/lit';
import {
  POLL_MS, STALLED, keepPolling, onTranscriptionEnabled, transcriptMessage, transcriptionEnabled, transcriptsApi,
} from '../lib/transcripts';

interface AttachmentModelLike {
  id?: string;
  props?: { sourceId?: string; type?: string; name?: string };
}

// The toolbar's `when` is synchronous, so the setting is mirrored here.
let enabled = false;
void transcriptionEnabled().then((v) => { enabled = v; });
onTranscriptionEnabled((v) => { enabled = v; });

const isVoiceNote = (m: AttachmentModelLike | null) => !!m?.props?.sourceId && !!m.props.type?.startsWith('audio/');

let open: { close: () => void } | null = null;

/** Close the card; the editor calls this as it unmounts. */
export function closeTranscriptCard(): void {
  open?.close();
}

/**
 * A page's voice note keeps its transcript out of the page: the block's
 * toolbar offers "Transcript", which opens a card under the player. The card
 * is plain DOM over the editor rather than part of the document, so the text
 * is never saved into the page or its history.
 */
function showTranscript(anchor: Element | null, key: string) {
  open?.close();
  // Focus moves into the card (so Esc and Tab work from the keyboard) and goes
  // back where it was when the card closes.
  const before = document.activeElement as HTMLElement | null;
  const card = document.createElement('div');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Transcript');
  card.style.cssText =
    'position:fixed;z-index:1000;max-width:min(560px,calc(100vw - 32px));max-height:min(320px,50vh);overflow:auto;' +
    'padding:10px 12px;border-radius:10px;background:var(--canvas);color:var(--ink);font-size:14px;line-height:20px;' +
    'box-shadow:0 2px 4px rgba(15,15,15,0.04),0 8px 24px rgba(15,15,15,0.10),0 0 0 1px var(--line)';
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px;font-size:12px;font-weight:600;color:var(--muted)';
  head.textContent = 'Transcript';
  const x = document.createElement('button');
  x.type = 'button';
  x.textContent = '×';
  x.setAttribute('aria-label', 'Close transcript');
  x.style.cssText = 'border:0;background:none;color:var(--faint);font-size:18px;line-height:1;cursor:pointer;padding:0 2px';
  head.append(x);
  const body = document.createElement('p');
  body.setAttribute('aria-live', 'polite');
  body.style.cssText = 'margin:0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--faint);font-size:13px';
  body.textContent = 'Transcribing…';
  card.append(head, body);
  document.body.append(card);

  const place = () => {
    // The block was deleted or the page re-rendered without it.
    if (anchor && !anchor.isConnected) { close(); return; }
    const r = anchor?.getBoundingClientRect();
    const left = Math.max(16, Math.min(r ? r.left : 16, window.innerWidth - card.offsetWidth - 16));
    const below = r ? r.bottom + 6 : 80;
    const top = below + card.offsetHeight > window.innerHeight - 8 && r ? Math.max(8, r.top - card.offsetHeight - 6) : below;
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  };
  let live = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const close = () => {
    if (!live) return;
    live = false;
    clearTimeout(timer);
    if (card.contains(document.activeElement)) before?.focus?.({ preventScroll: true });
    card.remove();
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
    if (open?.close === close) open = null;
  };
  const onOutside = (e: PointerEvent) => { if (!card.contains(e.target as Node)) close(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  x.addEventListener('click', close);
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);
  open = { close };
  place();
  x.focus({ preventScroll: true });

  let attempts = 0;
  const load = (retry: boolean) => {
    transcriptsApi.get(key, retry).then((t) => {
      if (!live) return;
      const message = transcriptMessage(t);
      body.textContent = message ?? t.text ?? '';
      body.style.color = message ? 'var(--faint)' : 'var(--ink)';
      body.style.fontSize = message ? '13px' : '14px';
      if (t.language) body.lang = t.language;
      const polling = keepPolling(t, attempts++);
      const stalled = !polling && t.status === 'pending';
      if (stalled) body.textContent = STALLED;
      if (t.status === 'failed' || stalled) {
        const again = document.createElement('button');
        again.type = 'button';
        again.textContent = 'Try again';
        again.style.cssText = 'margin-left:6px;border:0;background:none;padding:0;font:inherit;font-weight:600;color:var(--accent-strong);cursor:pointer';
        again.addEventListener('click', () => { attempts = 0; body.textContent = 'Transcribing…'; load(t.status === 'failed'); });
        body.append(again);
      }
      place();
      if (polling) timer = setTimeout(() => load(false), POLL_MS);
    }).catch(() => {
      if (live) body.textContent = 'Could not load the transcript.';
    });
  };
  load(false);
}

export function voiceTranscriptExtensions() {
  return [
    ToolbarModuleExtension({
      id: BlockFlavourIdentifier('custom:affine:attachment'),
      config: {
        actions: [
          {
            placement: ActionPlacement.Normal,
            id: 'a.transcript',
            tooltip: 'Transcript',
            icon: TextIcon(),
            when: (ctx: ToolbarContext) => {
              // An earlier failed read is asked again, for the next time the toolbar opens.
              if (!enabled) void transcriptionEnabled().then((v) => { enabled = v; });
              return enabled && isVoiceNote(ctx.getCurrentModel() as unknown as AttachmentModelLike | null);
            },
            run: (ctx: ToolbarContext) => {
              const model = ctx.getCurrentModel() as unknown as AttachmentModelLike | null;
              const key = model?.props?.sourceId;
              if (!key || !model?.id) return;
              const anchor = document.querySelector(`[data-block-id="${CSS.escape(model.id)}"]`);
              showTranscript(anchor, key);
            },
          },
        ],
      },
    }),
  ];
}
