import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { cn } from '../../lib/cn';

/**
 * The box a comment is typed into.
 *
 * It used to be a one-line `<input>`, and two things followed from that:
 *
 *  · A comment longer than the panel scrolled sideways out of sight, and there
 *    was no way to write a second line. This grows with what is typed, up to a
 *    cap, then scrolls. Enter still sends; Shift+Enter is a new line.
 *  · Coming back from another tab dropped the caret at the start. A one-line
 *    input scrolls back to its first character whenever it loses focus, and
 *    whatever focused it again — the panel's own refocus, a click on the
 *    visible start of the text — landed there. So the caret is remembered on
 *    every blur and put back whenever the box is focused by anything other
 *    than a click that places it deliberately.
 *
 * `draftKey` keeps the text itself across a remount: switching the side panel
 * to Outline and back unmounts the comments tab, and that used to throw away a
 * half-written comment along with its caret.
 */

interface Saved { text: string; start: number; end: number }
const drafts = new Map<string, Saved>();

/** What a draft key was holding, for callers that seed their own state. */
export const savedDraft = (key: string | undefined) => (key ? drafts.get(key)?.text ?? '' : '');

export interface CommentBoxHandle {
  focus: () => void;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Enter without Shift. Return true when the key was consumed (a mention pick). */
  onEnter: () => boolean | void;
  placeholder?: string;
  draftKey?: string;
  className?: string;
  maxHeight?: number;
}

export const CommentBox = forwardRef<CommentBoxHandle, Props>(function CommentBox(
  { value, onChange, onEnter, placeholder, draftKey, className, maxHeight = 160 },
  ref,
) {
  const area = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<{ start: number; end: number } | null>(null);
  // Set between a pointerdown on the box and the focus it causes: that click is
  // choosing where the caret goes, and restoring an old position over it would
  // be the same bug the other way round.
  const clicking = useRef(false);

  const restore = useCallback(() => {
    const el = area.current;
    if (!el) return;
    const at = caret.current ?? { start: el.value.length, end: el.value.length };
    const max = el.value.length;
    el.setSelectionRange(Math.min(at.start, max), Math.min(at.end, max));
  }, []);

  useImperativeHandle(ref, () => ({
    focus: () => {
      const el = area.current;
      if (!el) return;
      if (document.activeElement === el) return; // already there; leave the caret alone
      el.focus({ preventScroll: true });
      restore();
    },
  }), [restore]);

  // Grow to fit, up to the cap.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [value, maxHeight]);

  // Keep the draft (and where the caret was in it) for the next mount.
  useEffect(() => {
    if (!draftKey) return;
    // On a fresh mount `caret` is still empty; keep the position already saved.
    const at = caret.current ?? drafts.get(draftKey) ?? { start: value.length, end: value.length };
    if (value) drafts.set(draftKey, { text: value, start: at.start, end: at.end });
    else drafts.delete(draftKey);
  }, [draftKey, value]);

  // Back on a remount with a draft waiting: put the caret where it was.
  useEffect(() => {
    if (!draftKey) return;
    const saved = drafts.get(draftKey);
    if (!saved || !saved.text) return;
    caret.current = { start: saved.start, end: saved.end };
    const el = area.current;
    // Not on a phone: focusing would throw the keyboard up just for opening
    // the tab. The caret is still put back on the next tap-free focus.
    if (!el || window.matchMedia('(hover: none)').matches) return;
    el.focus({ preventScroll: true });
    restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // The window coming back. If the box had focus when the user left, it gets
  // it back with the caret where they left it — not wherever the browser or
  // the editor's own focus handling would put it.
  useEffect(() => {
    let hadFocus = false;
    const onHide = () => { hadFocus = document.activeElement === area.current; };
    const onShow = () => {
      if (!hadFocus || document.visibilityState !== 'visible') return;
      hadFocus = false;
      const el = area.current;
      if (!el) return;
      // After the browser's own focus restoration and anything reacting to it.
      requestAnimationFrame(() => {
        if (document.activeElement !== el) el.focus({ preventScroll: true });
        restore();
      });
    };
    const onVisibility = () => (document.visibilityState === 'hidden' ? onHide() : onShow());
    window.addEventListener('blur', onHide);
    window.addEventListener('focus', onShow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', onHide);
      window.removeEventListener('focus', onShow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [restore]);

  const remember = () => {
    const el = area.current;
    if (!el) return;
    caret.current = { start: el.selectionStart, end: el.selectionEnd };
    if (draftKey && el.value) drafts.set(draftKey, { text: el.value, ...caret.current });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // An IME's Enter confirms the composition; it is not "send".
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    onEnter();
  };

  return (
    <textarea
      ref={area}
      rows={1}
      value={value}
      placeholder={placeholder}
      onChange={(e) => {
        caret.current = { start: e.target.selectionStart, end: e.target.selectionEnd };
        onChange(e.target.value);
      }}
      onKeyDown={onKeyDown}
      onSelect={remember}
      onBlur={remember}
      onPointerDown={() => { clicking.current = true; }}
      onFocus={() => {
        if (clicking.current) { clicking.current = false; return; }
        // Keyboard or programmatic focus: back to where the caret was.
        requestAnimationFrame(restore);
      }}
      className={cn('block min-w-0 flex-1 resize-none bg-transparent text-sm leading-5 outline-none placeholder:text-faint', className)}
    />
  );
});
