// Minimal ZIP reader — the mirror of zip.js, enough to open a .docx.
//
// Same bargain as the writer: Node has inflateRaw built in, so an archiver
// dependency would buy about seventy lines. No zip64 and no encryption — a
// .docx that needs either is not a document anyone is importing into a notes
// app, and both are reported rather than silently mis-read.
//
// Sizes and offsets come from the central directory, never from the local
// header. Word writes some parts with a streaming data descriptor, which leaves
// the local header's sizes as zeroes; trusting them yields empty files.
import { inflateRawSync } from 'node:zlib';

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;

/** Scan back from the end for the end-of-central-directory record. */
function findEocd(buf) {
  // The record is 22 bytes plus a comment of up to 64KB. Walk back over that
  // window rather than assuming a comment-free archive.
  const earliest = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= earliest; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * Read every file in a ZIP.
 *
 * @param {Buffer} buf
 * @returns {Map<string, Buffer>} path inside the archive → its bytes
 * @throws if the archive is malformed, encrypted, or uses zip64
 */
export function unzipSync(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('Not a ZIP archive.');
  // A ZIP opens with a local file header, or — when it holds nothing — with the
  // end record itself. Checking here means a PDF or an old .doc renamed to
  // .docx fails with "not a ZIP" instead of "no EOCD found".
  const first = buf.readUInt32LE(0);
  if (first !== LOCAL_SIG && first !== EOCD_SIG) throw new Error('Not a ZIP archive.');

  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('ZIP end record not found — the file is truncated or not a ZIP.');
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === ZIP64_LOCATOR_SIG) {
    throw new Error('This archive uses zip64, which is not supported.');
  }

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();

  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL_SIG) {
      throw new Error('ZIP central directory is corrupt.');
    }
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    if (flags & 0x1) throw new Error('This file is password-protected.');
    if (compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('This archive uses zip64, which is not supported.');
    }

    // Directory entries are recorded like any other, with no data.
    if (!name.endsWith('/')) {
      if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL_SIG) {
        throw new Error(`ZIP entry "${name}" points outside the archive.`);
      }
      // The local header's own name and extra lengths are what locate the data —
      // its extra field routinely differs in length from the central one.
      const dataStart =
        localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > buf.length) throw new Error(`ZIP entry "${name}" is truncated.`);
      const body = buf.subarray(dataStart, dataEnd);

      if (method === 0) files.set(name, Buffer.from(body));
      else if (method === 8) files.set(name, inflateRawSync(body));
      else throw new Error(`ZIP entry "${name}" uses an unsupported compression method.`);
    }

    p += 46 + nameLen + extraLen + commentLen;
  }

  return files;
}
