import { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import {
  chooseFiles, IMPORT_PICKER_EVENT, IMPORT_SOURCES,
  type ImportPickerRequest, type ImportSource,
} from '../../lib/docFiles';

/**
 * What are you importing from? One row per source with a line on how to export
 * it there. Opened by pickImportFiles() (docFiles.ts) from every "Import"
 * button; choosing a row opens the file chooser, so the chooser still follows
 * a real click, which browsers require.
 */
export function ImportSourceDialog() {
  const [open, setOpen] = useState(false);
  const pending = useRef<((files: File[]) => void) | null>(null);

  useEffect(() => {
    const on = (e: Event) => {
      // A second request while one is open answers the first with nothing.
      pending.current?.([]);
      pending.current = (e as CustomEvent<ImportPickerRequest>).detail.resolve;
      setOpen(true);
    };
    window.addEventListener(IMPORT_PICKER_EVENT, on);
    return () => window.removeEventListener(IMPORT_PICKER_EVENT, on);
  }, []);

  const settle = (files: File[]) => {
    pending.current?.(files);
    pending.current = null;
    setOpen(false);
  };

  const pick = async (source: ImportSource) => settle(await chooseFiles(source));

  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) settle([]); }} title="Import" width={460}>
      <ul className="flex flex-col gap-1 p-2">
        {IMPORT_SOURCES.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => { void pick(s); }}
              className="flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
            >
              <span className="text-sm font-medium text-ink">{s.label}</span>
              <span className="text-2xs leading-4 text-muted">{s.how}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
