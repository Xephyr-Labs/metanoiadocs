// Uploading a file to the blob store the editor already uses. Blobs are
// content-addressed: the key IS the sha256 of the bytes, so the same file
// uploaded twice costs one row, and a key can never point at someone else's
// upload by accident.

/** What a `file` property stores per file. The bytes live in `blobs`. */
export interface StoredFile {
  key: string;
  name: string;
  mime: string;
  size: number;
}

/** 25 MB — the raw-body limit on PUT /api/blob. Refused here so the person
 *  finds out before the upload, not after it. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Store one file and return the reference to keep. Throws with a readable
 * message — every caller of this puts it straight in front of a person.
 */
export async function uploadFile(file: File): Promise<StoredFile> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`${file.name} is larger than ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB.`);
  }
  const bytes = await file.arrayBuffer();
  const key = await sha256(bytes);
  const res = await fetch(`/api/blob/${key}`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: bytes,
  });
  if (!res.ok) throw new Error(`Could not upload ${file.name}.`);
  return { key, name: file.name, mime: file.type || '', size: file.size };
}

/** Where to fetch a stored file. The name rides along so a download is called
 *  what it was called when it went up, rather than by its hash. */
export function fileUrl(file: StoredFile): string {
  return `/api/blob/${file.key}?name=${encodeURIComponent(file.name)}`;
}

export const isImageFile = (file: StoredFile) => /^image\//i.test(file.mime);

/** Human size, one decimal past a megabyte and none below it. */
export function formatBytes(size: number): string {
  if (!size) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1048576) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1048576).toFixed(1)} MB`;
}

/** Open the platform file dialog and hand back what was picked. Uses a plain
 *  input rather than `showOpenFilePicker`: that API is missing in Brave,
 *  Firefox and Safari — see editor/filePicker.ts. */
export function chooseFiles({ accept, multiple = true }: { accept?: string; multiple?: boolean } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    if (accept) input.accept = accept;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.append(input);
    input.addEventListener('change', () => {
      const files = [...(input.files ?? [])];
      input.remove();
      resolve(files);
    });
    // A cancelled dialog resolves empty: nothing to add is not an error.
    input.addEventListener('cancel', () => { input.remove(); resolve([]); });
    input.click();
  });
}
