import { Loader2 } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { field } from './styles';

interface Props {
  /** Fills the same 20px slot the tree rows use, so names stay on one rail. */
  icon?: ReactNode;
  defaultValue?: string;
  placeholder?: string;
  /** Accessible name — there is no visible label at this size. */
  label: string;
  /** Tree depth; matches the 16px-per-level indent of the rows around it. */
  depth?: number;
  /** Rejecting keeps the editor open with the message and the typed text. */
  onCommit: (value: string) => void | Promise<unknown>;
  onCancel: () => void;
}

/**
 * The one way a name gets typed inside a tree — naming a new project, renaming
 * a folder. The row *is* the editor, so naming something never throws the user
 * out to a browser dialog. Enter or blur commits, Escape cancels, and an empty
 * value cancels rather than saving a blank name.
 */
export function RowInput({ icon, defaultValue = '', placeholder, label, depth = 0, onCommit, onCancel }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Escape and a finished commit both end the editor; the blur that follows
  // must not fire a second one.
  const done = useRef(false);

  const commit = async (raw: string) => {
    if (done.current || busy) return;
    const value = raw.trim();
    if (!value || value === defaultValue) {
      done.current = true;
      onCancel();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCommit(value);
      done.current = true;
    } catch (e) {
      // Keep what was typed. Losing a name because the network blinked is
      // exactly what prompt() used to do to people.
      setError(e instanceof Error ? e.message : 'Could not save that name.');
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const cancel = () => {
    done.current = true;
    onCancel();
  };

  return (
    <div className="pr-1" style={{ paddingLeft: 8 + depth * 16 }}>
      <div className="flex h-8 items-center">
        <span className="mr-1.5 flex h-5 w-5 shrink-0 items-center justify-center text-faint">
          {busy ? <Loader2 size={14} className="animate-spin" /> : icon}
        </span>
        <input
          ref={inputRef}
          autoFocus
          disabled={busy}
          defaultValue={defaultValue}
          placeholder={placeholder}
          aria-label={label}
          aria-invalid={!!error}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(e.currentTarget.value);
            // Don't let Escape travel on to whatever is listening above.
            if (e.key === 'Escape') { e.stopPropagation(); cancel(); }
          }}
          onBlur={(e) => commit(e.target.value)}
          className={cn(field, 'h-7 min-w-0 flex-1 px-1.5 text-base', error && 'ring-danger focus:ring-danger')}
        />
      </div>
      {error && <p role="alert" className="pb-1 pl-7 text-2xs text-danger">{error}</p>}
    </div>
  );
}
