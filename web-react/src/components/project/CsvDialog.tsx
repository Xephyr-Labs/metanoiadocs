/* Hallmark · component: CSV import · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H4 E5 S5 R5 V4
 * states: default (no file) · reading · mapped (preview) · importing · done ·
 *         failed · empty (file with no rows)
 */
import { useRef, useState } from 'react';
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { cn } from '../../lib/cn';
import { tasksApi, type CsvImportResult } from '../../lib/tasksApi';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Re-read the board once rows have landed. */
  onImported: () => void;
}

/** What each mapped column will do, in the words the person used for it. */
const VERDICT: Record<string, string> = {
  builtin: 'a built-in field',
  prop: 'an existing property',
  new: 'not matched',
  skip: 'ignored — no header',
};

/**
 * Reading a spreadsheet into a database.
 *
 * Two steps on purpose. The first asks the server what it *would* do and
 * writes nothing: which column means what, how many rows survive, what is
 * wrong with the ones that do not. Only then is there a button that writes.
 * An import is the one gesture in this app that can add a thousand rows, and
 * an undo for that does not exist — so the preview is the undo.
 */
export function CsvDialog({ open, onOpenChange, projectId, onImported }: Props) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<CsvImportResult | null>(null);
  const [createMissing, setCreateMissing] = useState(true);
  const [state, setState] = useState<'idle' | 'reading' | 'importing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setError(null);
    setDone(null);
    setState('idle');
  };

  const look = async (text: string, create: boolean) => {
    setState('reading');
    setError(null);
    try {
      setPreview(await tasksApi.importCsv(projectId, text, { dry: true, create }));
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    } finally {
      setState('idle');
    }
  };

  const choose = async (picked: File | null) => {
    if (!picked) return;
    setDone(null);
    const text = await picked.text();
    setFile({ name: picked.name, text });
    await look(text, createMissing);
  };

  const run = async () => {
    if (!file) return;
    setState('importing');
    setError(null);
    try {
      const result = await tasksApi.importCsv(projectId, file.text, { create: createMissing });
      setDone(result.created);
      setPreview(result);
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not import that file.');
    } finally {
      setState('idle');
    }
  };

  const unmatched = preview?.columns.filter((c) => c.kind === 'new') ?? [];

  return (
    <Modal
      open={open}
      onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}
      title="Import a CSV"
      width={520}
      focusPanel
    >
      <div className="px-4 py-3.5">
        {done !== null ? (
          <div className="py-2">
            <p className="text-sm text-ink">
              {done === 0 ? 'Nothing was added.' : `Added ${done} ${done === 1 ? 'row' : 'rows'}.`}
            </p>
            {preview && preview.errorCount > 0 && (
              <p className="mt-1 text-2xs text-muted">
                {preview.errorCount} {preview.errorCount === 1 ? 'row was' : 'rows were'} skipped.
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => { reset(); inputRef.current?.click(); }}>Import another</Button>
              <Button variant="primary" size="sm" onClick={() => { reset(); onOpenChange(false); }}>Done</Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm leading-6 text-muted">
              One column has to be called <span className="font-medium text-ink">Title</span>. Others
              are matched to this database's properties by name — Status, Assignee, Due date, Points
              and Estimate are understood too.
            </p>

            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="sr-only"
              onChange={(e) => { void choose(e.target.files?.[0] ?? null); e.target.value = ''; }}
            />

            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" leftIcon={<Upload size={14} />} onClick={() => inputRef.current?.click()}>
                Choose a file
              </Button>
              {file && (
                <span className="flex min-w-0 items-center gap-1.5 text-2xs text-muted">
                  <FileSpreadsheet size={13} className="shrink-0 text-faint" />
                  <span className="truncate">{file.name}</span>
                </span>
              )}
              {state === 'reading' && <Loader2 size={14} className="animate-spin text-faint" />}
            </div>

            {preview && (
              <>
                <div className="mt-3.5 overflow-hidden rounded border border-line">
                  <table className="w-full text-2xs">
                    <thead className="bg-surface text-faint">
                      <tr>
                        <th className="px-2.5 py-1.5 text-left font-medium">Column</th>
                        <th className="px-2.5 py-1.5 text-left font-medium">Goes to</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.columns.map((c, i) => (
                        <tr key={`${c.header}-${i}`} className="border-t border-line">
                          <td className="max-w-[14rem] truncate px-2.5 py-1.5 text-ink">{c.header || <span className="text-faint">(no header)</span>}</td>
                          <td className={cn('px-2.5 py-1.5', c.kind === 'new' && !createMissing ? 'text-faint' : 'text-muted')}>
                            {c.kind === 'new'
                              ? (createMissing ? 'a new text property' : 'not matched — will be skipped')
                              : VERDICT[c.kind]}
                            {/* Said out loud: a database with its own "Status"
                                property would otherwise look like it had
                                imported, with every row left in To do. */}
                            {c.shadows && (
                              <span className="text-faint"> — not the “{c.shadows}” property</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {unmatched.length > 0 && (
                  <label className="mt-2 flex items-center gap-2 text-2xs text-muted">
                    <input
                      type="checkbox"
                      checked={createMissing}
                      onChange={(e) => {
                        setCreateMissing(e.target.checked);
                        if (file) void look(file.text, e.target.checked);
                      }}
                      className="h-3.5 w-3.5 rounded border-line text-accent-fill focus:ring-2 focus:ring-accent"
                    />
                    Add a property for each unmatched column
                  </label>
                )}

                <p className="mt-3 text-sm text-ink">
                  {preview.created} {preview.created === 1 ? 'row' : 'rows'} ready
                  {preview.errorCount > 0 && (
                    <span className="text-muted">
                      , {preview.errorCount} skipped
                    </span>
                  )}
                </p>
                {preview.errors.length > 0 && (
                  <ul className="mt-1 max-h-24 overflow-auto text-2xs text-muted">
                    {preview.errors.map((e) => (
                      <li key={e.line}>Line {e.line}: {e.error}</li>
                    ))}
                  </ul>
                )}

                <div className="mt-3.5 flex items-center gap-2 border-t border-line pt-3">
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={state !== 'idle' || preview.created === 0}
                    onClick={() => void run()}
                  >
                    {state === 'importing' ? 'Importing…' : `Import ${preview.created} ${preview.created === 1 ? 'row' : 'rows'}`}
                  </Button>
                  <Button size="sm" onClick={reset}>Start over</Button>
                  {state === 'importing' && <Loader2 size={14} className="animate-spin text-faint" />}
                </div>
              </>
            )}
          </>
        )}

        {error && <p role="alert" className="mt-2.5 text-2xs text-danger-strong">{error}</p>}
      </div>
    </Modal>
  );
}
