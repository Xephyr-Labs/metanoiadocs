// Minimal ZIP writer — enough to build a .docx, which is a ZIP of XML parts.
//
// Node ships everything the hard parts need (deflateRawSync since forever,
// crc32 since 22.2), so a whole archiver dependency would buy us about sixty
// lines. No zip64, no encryption, no directory entries: a docx has a handful of
// small parts and never comes near the 4GB fields.
import { deflateRawSync, crc32 } from 'node:zlib';

// A fixed timestamp rather than the clock: two exports of an unchanged document
// then produce byte-identical files, which makes them diffable and cacheable.
// 1980-01-01 is the DOS epoch, the earliest a ZIP can express.
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

/**
 * @param {{name: string, data: Buffer|string}[]} files
 * @returns {Buffer} the archive
 */
export function zipSync(files) {
  const local = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    // Already-compressed bytes (PNG, JPEG) only grow when deflated, so store
    // those verbatim; method 0 is as valid as method 8.
    const deflated = deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const method = stored ? 0 : 8;
    const sum = crc32(data);

    const head = Buffer.alloc(30);
    head.writeUInt32LE(LOCAL_SIG, 0);
    head.writeUInt16LE(20, 4); // version needed
    head.writeUInt16LE(0, 6); // flags
    head.writeUInt16LE(method, 8);
    head.writeUInt16LE(DOS_TIME, 10);
    head.writeUInt16LE(DOS_DATE, 12);
    head.writeUInt32LE(sum, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(name.length, 26);
    head.writeUInt16LE(0, 28); // extra field length
    local.push(head, name, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(CENTRAL_SIG, 0);
    dir.writeUInt16LE(20, 4); // version made by
    dir.writeUInt16LE(20, 6); // version needed
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(sum, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt16LE(0, 30); // extra
    dir.writeUInt16LE(0, 32); // comment
    dir.writeUInt16LE(0, 34); // disk number
    dir.writeUInt16LE(0, 36); // internal attrs
    dir.writeUInt32LE(0, 38); // external attrs
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);

    offset += head.length + name.length + body.length;
  }

  const dirBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD_SIG, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dirBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length
  return Buffer.concat([...local, dirBytes, end]);
}

/**
 * Pixel dimensions from an image's own header. Word needs a size in EMU for
 * every picture, and getting it wrong squashes the image — so an unreadable
 * header returns null and the caller falls back to a fixed width rather than
 * guessing an aspect ratio.
 */
export function imageSize(buf) {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }; // PNG IHDR
  }
  if (buf.length >= 10 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }; // GIF
  }
  if (buf.length >= 30 && buf.readUInt32BE(0) === 0x52494646 && buf.readUInt32BE(8) === 0x57454250) {
    // WebP: only the simple lossy (VP8 ) and lossless (VP8L) forms; an animated
    // or extended file falls through to null.
    const fourcc = buf.toString('ascii', 12, 16);
    if (fourcc === 'VP8 ' && buf.length >= 30) {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (fourcc === 'VP8L' && buf.length >= 25) {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    // JPEG: walk the segment chain to the frame header that carries the size.
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      // SOF0-SOF15, minus the two that are not frame headers (DHT 0xc4, DAC 0xcc).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xcc) {
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      if (len < 2) return null;
      i += 2 + len;
    }
  }
  return null;
}
