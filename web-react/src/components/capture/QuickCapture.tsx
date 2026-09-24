/* Hallmark · component: quick capture box · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: default · hover · focus · active · disabled (no database, or empty
 *         line) · loading (saving) · error (the write failed) · success
 *         (saved — the toast carries it, and the box either closes or clears)
 */
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { toast } from '../../lib/toast';
import { splitKey } from '../../lib/taskKey';
import { tasksApi } from '../../lib/tasksApi';
import { useWorkspace } from '../../store/workspace';
import { Modal } from '../ui/Modal';
import { SearchSelect } from '../ui/SearchSelect';
import { Kbd } from '../ui/Kbd';
import { ProjectIcon } from '../ui/ProjectIcon';

/** The database the last capture went to, so the next one does not ask again. */
const LAST_KEY = 'mn-capture-db';

const readLast = (): string | null => {
  try { return localStorage.getItem(LAST_KEY); } catch { return null; }
};

/**
 * One line, one key, and you are back where you were.
 *
 * The thing every task app loses people on is the gap between having a thought
 * and having somewhere to put it: open the right database, find the right
 * view, press the right button, and by then the thought is gone. `n` opens
 * this over whatever is on screen, and Enter puts the line in a database
 * without navigating anywhere.
 *
 * Deliberately not a new concept. There is no "inbox" database invented here —
 * the line goes into one of the databases that already exist, remembered from
 * last time, because a second place work can hide is not an improvement on
 * work being hard to write down.
 *
 * Shift+Enter keeps the box open. Capturing is usually three things at once,
 * and closing after each one is three keystrokes to get back.
 */
export function QuickCapture() {
  const ws = useWorkspace();
  const [text, setText] = useState('');
  const [target, setTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Task databases only: a data database has no status and no board, so a line
  // captured into one lands as a row nobody is ever shown.
  const options = ws.projects
    .filter((p) => p.mode !== 'data')
    .map((p) => ({ value: p.id, label: p.name, lead: <ProjectIcon project={p} size={14} /> }));

  // Opening is what resets it. The database it opens on is, in order: the one
  // you are looking at, the one you used last, the first one there is.
  useEffect(() => {
    if (!ws.captureOpen) return;
    setText('');
    setError(null);
    setSaving(false);
    const remembered = readLast();
    const viable = (id: string | null) => !!id && options.some((o) => o.value === id);
    setTarget(
      viable(ws.activeProjectId) ? ws.activeProjectId
        : viable(remembered) ? remembered
        : options[0]?.value ?? null,
    );
    // Radix would land focus on the close button, whose tooltip opens at 0ms.
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.captureOpen]);

  const save = async (keepOpen: boolean) => {
    const title = text.trim();
    if (!title || !target || saving) return;
    setSaving(true);
    setError(null);
    try {
      const row = await tasksApi.createTask({ projectId: target, title });
      try { localStorage.setItem(LAST_KEY, target); } catch { /* private mode */ }
      void ws.refreshProjects();
      const named = splitKey(row.title);
      // The key is the useful half of the confirmation: it is what you would
      // quote to somebody, and seeing it is how you know the row is real.
      toast(named.key ? `Added ${named.key}` : 'Task added', {
        label: 'Open',
        onSelect: () => ws.openProject(target, row.id),
      });
      if (keepOpen) {
        setText('');
        // After the flush, not now. The field is `disabled` while the save is
        // in flight, and focusing a disabled input does nothing at all — so
        // this used to leave the box open with the caret gone, and the next
        // line someone typed went nowhere. `setSaving(false)` has not been
        // applied yet at this point (it runs in the finally below), so the
        // focus has to wait for React to re-enable the field.
        window.setTimeout(() => inputRef.current?.focus(), 0);
      } else {
        ws.setCaptureOpen(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setSaving(false);
    }
  };

  const ready = !!text.trim() && !!target && !saving;

  return (
    <Modal
      open={ws.captureOpen}
      onOpenChange={ws.setCaptureOpen}
      title="Quick capture"
      bare
      placement="top"
      width={540}
      focusPanel
    >
      <div className="flex items-center gap-2.5 border-b border-line px-4">
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => { setText(e.target.value); setError(null); }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            void save(e.shiftKey);
          }}
          placeholder="What needs doing?"
          aria-label="What needs doing?"
          disabled={saving}
          maxLength={500}
          className="h-[52px] flex-1 bg-transparent text-md text-ink outline-none placeholder:text-faint"
        />
        {saving && <Loader2 size={14} className="shrink-0 animate-spin text-faint" aria-label="Saving" />}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        {options.length > 0 ? (
          <SearchSelect
            value={target}
            options={options}
            label="Which database"
            placeholder="Pick a database"
            className="w-[220px]"
            onChange={setTarget}
          />
        ) : (
          // Honest rather than hopeful: with no database there is nowhere for
          // a line to go, and a box that accepted one anyway would lose it.
          <p className="text-2xs text-faint">Make a database first — a captured line has to live somewhere.</p>
        )}

        <span className="ml-auto flex items-center gap-2 text-2xs text-faint">
          {error ? (
            <span role="alert" className="flex items-center gap-1 text-danger-strong">
              <AlertCircle size={13} />{error}
            </span>
          ) : (
            <>
              <span className="flex items-center gap-1"><Kbd>↵</Kbd> save</span>
              <span className="flex items-center gap-1"><Kbd>⇧</Kbd><Kbd>↵</Kbd> save &amp; keep going</span>
            </>
          )}
        </span>
      </div>

      {/* The button exists for the pointer; the keys above are the real path.
          Disabled until there is something to save, so it never lies about
          being pressable. */}
      <div className="flex shrink-0 items-center justify-end border-t border-line px-3 py-2">
        <button
          type="button"
          disabled={!ready}
          onClick={() => void save(false)}
          className={cn(
            'h-7 rounded-md px-3 text-xs font-medium transition-colors',
            'bg-accent-fill text-white hover:opacity-90',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            'disabled:pointer-events-none disabled:opacity-40',
          )}
        >
          {saving ? 'Saving…' : 'Add task'}
        </button>
      </div>
    </Modal>
  );
}
