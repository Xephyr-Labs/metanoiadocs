import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '../../lib/cn';
import type { UserRow } from '../../lib/docsApi';
import { applyMention, matchPeople, mentionQuery } from '../../lib/mentions';
import { Avatar } from './Avatar';

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
 * `people` turns on @-mentions: typing "@" offers the matching teammates in a
 * menu above the box, which the keyboard drives — ↑/↓ to move, Enter or Tab
 * to pick, Esc to close. It lives here rather than in each caller because two
 * callers had grown two menus, and neither answered the arrow keys.
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
  /** Who an "@" can mention. Omitted: no mention menu. */
  people?: UserRow[];
}

export const CommentBox = forwardRef<CommentBoxHandle, Props>(function CommentBox(
  { value, onChange, onEnter, placeholder, draftKey, className, maxHeight = 160, people },
  ref,
) {
  // The menu is closed by Esc or by leaving the box, and reopens on the next
  // keystroke; `active` is the highlighted row.
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const query = people && !dismissed ? mentionQuery(value) : null;
  const matches = query === null ? [] : matchPeople(people!, query);
  const at = Math.min(active, Math.max(0, matches.length - 1));
  // Above the box by default (the composer sits at the bottom of the panel),
  // below it when the scrolling list it sits in has no room above — a reply
  // box near the top of the threads would otherwise have its menu cut off.
  const [below, setBelow] = useState(false);
  const open = matches.length > 0;
  useLayoutEffect(() => {
    const el = area.current;
    if (!open || !el) return;
    let scroller: HTMLElement | null = el.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const roomAbove = el.getBoundingClientRect().top - (scroller?.getBoundingClientRect().top ?? 0);
    setBelow(roomAbove < matches.length * 32 + 16);
  }, [open, matches.length]);
  const pickPerson = (u: UserRow) => {
    onChange(applyMention(value, u.username));
    setActive(0);
  };
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
    if (e.nativeEvent.isComposing) return;
    if (matches.length) {
      const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      if (step) {
        e.preventDefault();
        setActive((at + step + matches.length) % matches.length);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        pickPerson(matches[at]);
        return;
      }
      if (e.key === 'Escape') {
        // The menu's Esc, not the panel's.
        e.preventDefault();
        e.stopPropagation();
        setDismissed(true);
        return;
      }
    }
    // An IME's Enter confirms the composition; it is not "send".
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    onEnter();
  };

  return (
    <div className="relative min-w-0 flex-1">
    {matches.length > 0 && (
      <div
        id={listId}
        role="listbox"
        aria-label="Mention someone"
        className={cn(
          'absolute left-0 right-0 z-10 overflow-hidden rounded-lg border border-line bg-canvas py-1 shadow-pop',
          below ? 'top-full mt-2' : 'bottom-full mb-2',
        )}
      >
        {matches.map((u, i) => (
          <div
            key={u.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === at}
            // mousedown, not click: the box would blur first and close the menu.
            onMouseDown={(e) => { e.preventDefault(); pickPerson(u); }}
            onMouseEnter={() => setActive(i)}
            className={cn('flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm', i === at && 'bg-hover')}
          >
            <Avatar name={u.name || u.username || u.email} size={18} />
            <span className="font-medium text-ink">{u.name || u.username}</span>
            <span className="truncate text-2xs text-faint">@{u.username}</span>
          </div>
        ))}
      </div>
    )}
    <textarea
      ref={area}
      rows={1}
      value={value}
      placeholder={placeholder}
      onChange={(e) => {
        caret.current = { start: e.target.selectionStart, end: e.target.selectionEnd };
        setDismissed(false);
        setActive(0);
        onChange(e.target.value);
      }}
      onKeyDown={onKeyDown}
      role={people ? 'combobox' : undefined}
      aria-expanded={people ? matches.length > 0 : undefined}
      aria-controls={matches.length ? listId : undefined}
      aria-activedescendant={matches.length ? `${listId}-${at}` : undefined}
      onSelect={remember}
      onBlur={() => { remember(); setDismissed(true); }}
      onPointerDown={() => { clicking.current = true; }}
      onFocus={() => {
        if (clicking.current) { clicking.current = false; return; }
        // Keyboard or programmatic focus: back to where the caret was.
        requestAnimationFrame(restore);
      }}
      className={cn('block w-full resize-none bg-transparent text-sm leading-5 outline-none placeholder:text-faint', className)}
    />
    </div>
  );
});
