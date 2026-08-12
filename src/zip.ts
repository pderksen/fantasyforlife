import { deflateRawSync } from "node:zlib";

/**
 * Minimal ZIP writer, enough to package an .xlsx.
 *
 * An .xlsx is a zip of XML parts, and Node ships the only hard part (`zlib`), so this
 * keeps the project's zero-dependency rule rather than pulling in a spreadsheet library.
 * Write-only and deliberately narrow: no reading, no zip64, no directory entries, no
 * encryption. Every part we emit is far under the 4GB fields, so 32-bit sizes are safe.
 */
export interface ZipEntry {
  /** Path inside the archive, forward slashes, no leading slash. */
  name: string;
  data: Uint8Array | string;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Fixed DOS timestamp: 1980-01-01 00:00, the epoch of the format.
 *
 * Deliberately not the current time. `output/` is committed, and the repo leans on an empty
 * `git diff` to prove a change had no effect — a clock in the header would make every
 * regeneration a diff and destroy that check.
 */
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const VERSION = 20; // 2.0 — the floor for deflate

interface StagedEntry {
  nameBytes: Buffer;
  body: Buffer;
  method: number;
  crc: number;
  rawSize: number;
  offset: number;
}

export function zipSync(entries: ZipEntry[]): Buffer {
  const staged: StagedEntry[] = [];
  const localChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const raw = typeof entry.data === "string"
      ? Buffer.from(entry.data, "utf-8")
      : Buffer.from(entry.data);
    const deflated = deflateRawSync(raw, { level: 9 });
    // Tiny parts can deflate larger than they started; store those verbatim.
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const nameBytes = Buffer.from(entry.name, "utf-8");
    const crc = crc32(raw);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL_HEADER_SIG, 0);
    header.writeUInt16LE(VERSION, 4);
    header.writeUInt16LE(0, 6);                    // flags
    header.writeUInt16LE(useDeflate ? 8 : 0, 8);   // method
    header.writeUInt16LE(DOS_TIME, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28);                   // extra field length

    localChunks.push(header, nameBytes, body);
    staged.push({ nameBytes, body, method: useDeflate ? 8 : 0, crc, rawSize: raw.length, offset });
    offset += header.length + nameBytes.length + body.length;
  }

  const centralChunks: Buffer[] = [];
  let centralSize = 0;
  for (const e of staged) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(CENTRAL_HEADER_SIG, 0);
    header.writeUInt16LE(VERSION, 4);              // version made by
    header.writeUInt16LE(VERSION, 6);              // version needed
    header.writeUInt16LE(0, 8);                    // flags
    header.writeUInt16LE(e.method, 10);
    header.writeUInt16LE(DOS_TIME, 12);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(e.crc, 16);
    header.writeUInt32LE(e.body.length, 20);
    header.writeUInt32LE(e.rawSize, 24);
    header.writeUInt16LE(e.nameBytes.length, 28);
    header.writeUInt16LE(0, 30);                   // extra field length
    header.writeUInt16LE(0, 32);                   // comment length
    header.writeUInt16LE(0, 34);                   // disk number
    header.writeUInt16LE(0, 36);                   // internal attributes
    header.writeUInt32LE(0, 38);                   // external attributes
    header.writeUInt32LE(e.offset, 42);

    centralChunks.push(header, e.nameBytes);
    centralSize += header.length + e.nameBytes.length;
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);                        // this disk
  eocd.writeUInt16LE(0, 6);                        // disk with central directory
  eocd.writeUInt16LE(staged.length, 8);
  eocd.writeUInt16LE(staged.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);                       // comment length

  return Buffer.concat([...localChunks, ...centralChunks, eocd]);
}
