// Every "pick a file" path in the editor — Image, Photo, Attachment, PDF, the
// import dialog — goes through `window.showOpenFilePicker`, the File System
// Access API. Brave blocks it outright, Firefox and Safari have never shipped
// it, and enterprise policy can switch it off in Chrome. When it is missing the
// menu item is still there and clicking it does nothing at all: no picker, no
// error, no block. That is why "add an image" reads as a missing feature.
//
// This installs the old reliable — a hidden `<input type="file">` — under the
// same name, so BlockSuite keeps calling one API and every upload path works in
// every browser. See also the AFFiNE markdown-import failure, which was the
// same API, the same browser, and the same silence.

interface PickerType {
  description?: string;
  accept?: Record<string, string | string[]>;
}
interface PickerOptions {
  multiple?: boolean;
  types?: PickerType[];
  excludeAcceptAllOption?: boolean;
}

/** The `accept` attribute for an `<input type="file">`, from the API's
 *  `types` — MIME keys and their extension lists both count. */
function acceptFrom(types: PickerType[] | undefined): string {
  if (!types?.length) return '';
  const parts: string[] = [];
  for (const type of types) {
    for (const [mime, exts] of Object.entries(type.accept ?? {})) {
      if (mime) parts.push(mime);
      for (const ext of Array.isArray(exts) ? exts : [exts]) if (ext) parts.push(ext);
    }
  }
  return [...new Set(parts)].join(',');
}

/** Enough of a FileSystemFileHandle for a reader: the name and the bytes.
 *  Nothing in the editor writes back through a handle — it reads the file and
 *  puts the result in the document. */
function handleFor(file: File) {
  return {
    kind: 'file' as const,
    name: file.name,
    getFile: async () => file,
    isSameEntry: async () => false,
  };
}

function pick(options: PickerOptions = {}): Promise<ReturnType<typeof handleFor>[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = !!options.multiple;
    const accept = acceptFrom(options.types);
    if (accept && options.excludeAcceptAllOption !== false) input.accept = accept;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.append(input);

    let settled = false;
    const done = (run: () => void) => {
      if (settled) return;
      settled = true;
      input.remove();
      run();
    };

    input.addEventListener('change', () => {
      const files = [...(input.files ?? [])];
      // The API rejects on cancel rather than resolving empty, and callers are
      // written around that — an empty resolve would look like a real pick of
      // nothing and insert an empty block.
      done(() => (files.length
        ? resolve(files.map(handleFor))
        : reject(new DOMException('The user aborted a request.', 'AbortError'))));
    });
    // Cancel fires on modern browsers; the focus fallback covers the rest, one
    // frame late so a change event that is on its way still wins the race.
    input.addEventListener('cancel', () => {
      done(() => reject(new DOMException('The user aborted a request.', 'AbortError')));
    });
    window.addEventListener('focus', () => {
      setTimeout(() => {
        if (!input.files?.length) {
          done(() => reject(new DOMException('The user aborted a request.', 'AbortError')));
        }
      }, 350);
    }, { once: true });

    input.click();
  });
}

/**
 * Install the fallback when the native picker is unavailable. Idempotent, and
 * it never replaces a working native implementation — a browser that has the
 * real thing keeps it, along with its directory and save-file support.
 */
export function installFilePickerFallback(): void {
  const w = window as unknown as { showOpenFilePicker?: unknown };
  if (typeof w.showOpenFilePicker === 'function') return;
  w.showOpenFilePicker = pick;
}
