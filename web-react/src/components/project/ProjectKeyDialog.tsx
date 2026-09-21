/* Hallmark · component: project task-key editor · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: default · hover · focus · active · disabled · loading · error · success
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { tasksApi, type ProjectRow, type TaskRow } from '../../lib/tasksApi';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { field } from '../ui/styles';

/** Mirrors KEY_PREFIX in server/src/task-key.js. It is here only to draw the
 *  preview line — the server is what actually rewrites a title, and it is the
 *  one that decides. Keep the two in step if either moves. */
const KEY_PREFIX = /^[A-Za-z][A-Za-z0-9]{0,7}-\d+: */;

/**
 * Why a key cannot be used, in the words it should be refused in — or null.
 *
 * Checked here as well as on the server so a typo answers instantly instead of
 * after a round trip. The server still refuses it: this is a courtesy, not the
 * gate. Uniqueness is the one rule only the server can know, and it comes back
 * as a 409.
 */
export function keyProblem(key: string): string | null {
  if (!key) return 'A key cannot be empty.';
  if (key.length > 8) return 'Eight characters at most.';
  if (!/^[A-Za-z]/.test(key)) return 'A key starts with a letter.';
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) return 'Letters and digits only — no spaces or punctuation.';
  return null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectRow;
  /** The project's tasks, for the preview line and the honest count. */
  tasks: TaskRow[];
  /** Re-read the project list and the tasks: every title on screen has changed. */
  onSaved: () => void;
  /** A data database calls them rows, and so should this. */
  isData?: boolean;
}

/**
 * The short name in front of every task number: the PAY of PAY-14.
 *
 * Small enough to be a field on a settings page, except there isn't one — a
 * database is renamed inline in the sidebar and has no settings surface of its
 * own. It gets a dialog instead, off the same menu as Task types and
 * Properties, because the change is not small: saving rewrites every task
 * title in the database, and the person doing it should see what they are
 * about to rename before they rename it.
 */
export function ProjectKeyDialog({ open, onOpenChange, project, tasks, onSaved, isData }: Props) {
  const current = project.key ?? '';
  const [draft, setDraft] = useState(current);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Read by the reset below, which must not re-run when this changes — saving
  // is what changes it.
  const currentRef = useRef(current);
  currentRef.current = current;

  // Opening is what resets it, not closing: a dialog that clears on the way out
  // shows the clearing.
  //
  // Opening is also the ONLY thing that resets it. A successful save refreshes
  // the project, so `project.key` becomes the key that was just written — and
  // if that fed this effect, the save would wipe its own "Saved" state and the
  // dialog would sit there looking like nothing had happened.
  //
  // The focus moves to the field in the same pass. Radix would otherwise land
  // it on the close button, whose tooltip opens at 0ms on focus — so the first
  // thing this dialog says would be "Close".
  useEffect(() => {
    if (!open) return;
    setDraft(currentRef.current);
    setState('idle');
    setError(null);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  // The success state is the last thing seen, so it has to be seen — long
  // enough to read, short enough not to be a second click. Cleared on unmount,
  // or a dialog dismissed at 690ms closes itself again on the way past.
  useEffect(() => {
    if (state !== 'saved') return;
    const t = window.setTimeout(() => onOpenChange(false), 700);
    return () => window.clearTimeout(t);
  }, [state, onOpenChange]);

  const noun = isData ? 'row' : 'task';
  // Numbered tasks only: the count is a promise about what this rename touches,
  // so it counts what it will touch.
  const numbered = useMemo(() => tasks.filter((t) => t.num != null), [tasks]);
  const sample = useMemo(
    () => numbered.reduce<TaskRow | null>((low, t) => (!low || t.num! < low.num! ? t : low), null),
    [numbered],
  );

  const key = draft.trim().toUpperCase();
  const changed = key !== current;
  const preview = sample
    ? `${key || '—'}-${sample.num}: ${sample.title.replace(KEY_PREFIX, '')}`
    : `${key || '—'}-1`;

  const save = async () => {
    if (!changed || state === 'saving') return;
    const bad = keyProblem(key);
    if (bad) {
      setError(bad);
      inputRef.current?.focus();
      return;
    }
    setState('saving');
    setError(null);
    try {
      await tasksApi.patchProject(project.id, { key });
      // Every title on screen is stale now — the board, the table, the gantt
      // and the sidebar all read the same column.
      onSaved();
      setState('saved');
    } catch (e) {
      setState('idle');
      setError(e instanceof Error ? e.message : 'Could not save that key.');
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={isData ? 'Row key' : 'Task key'}
      width={420}
      focusPanel
    >
      <div className="px-4 py-3.5">
        {/* No second "Key" label above the field: the dialog is named Task key
            and holds one control, so a heading over it repeats the heading. */}
        <input
          id="project-key"
          ref={inputRef}
          aria-label={isData ? 'Row key' : 'Task key'}
          value={draft}
          maxLength={8}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'project-key-error' : 'project-key-hint'}
          disabled={state !== 'idle'}
          onChange={(e) => {
            // Upper-cased as it is typed, because that is how it will be
            // stored: a field that quietly rewrites what you typed on save is
            // a field that lied while you were typing.
            setDraft(e.target.value.toUpperCase());
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
          }}
          className={cn(
            field,
            'max-w-[9rem] font-semibold uppercase tracking-[0.08em]',
            error && 'ring-2 ring-danger-strong focus:ring-danger-strong',
          )}
        />

        {error ? (
          <p id="project-key-error" role="alert" className="mt-1.5 text-2xs text-danger-strong">
            {error}
          </p>
        ) : (
          <p id="project-key-hint" className="mt-1.5 text-2xs leading-4 text-faint">
            One to eight letters or digits, starting with a letter. Every {noun} in this
            database is named after it.
          </p>
        )}

        <p className="mt-3 truncate rounded-md bg-surface px-2.5 py-1.5 text-sm text-ink" title={preview}>
          {preview}
        </p>

        {/* Nothing invented: the count is the numbered rows actually loaded, and
            the example is drawn from one of them. With none, both clauses go. */}
        {numbered.length > 0 && (
          <p className="mt-2 text-2xs leading-4 text-faint">
            {changed && !error ? 'Saving renames ' : 'Renaming rewrites '}
            {numbered.length} {noun} title{numbered.length === 1 ? '' : 's'}. Numbers do not move
            {changed && !error && sample && current
              ? ` — ${current}-${sample.num} becomes ${key}-${sample.num}`
              : ''}
            .
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-3 py-2.5">
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={!changed || state !== 'idle'}
          leftIcon={
            state === 'saving' ? <Loader2 size={14} className="animate-spin" />
              : state === 'saved' ? <Check size={14} />
              : undefined
          }
          onClick={() => void save()}
        >
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : 'Save'}
        </Button>
      </div>
    </Modal>
  );
}
