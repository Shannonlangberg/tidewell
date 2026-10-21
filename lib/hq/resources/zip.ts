/*
 * A tiny, dependency-free ZIP writer: "stored" (no compression) entries, UTF-8 names, a CRC-32 per file.
 * Enough for the brand library (a few megabytes of SVG, PNG, JPEG, CSS and text), which is why there is no
 * compression and no streaming: the route builds the whole archive in memory and answers with it.
 *
 * Limits (the classic ZIP format, no ZIP64): at most 65,535 entries and 4 GiB in all. The route caps the
 * total long before that (rules.ts ZIP_MAX_BYTES).
 *
 * Pure: no imports.
 */

export type ZipEntry = { name: string; data: Uint8Array; modified?: Date };

let TABLE: Uint32Array | null = null;
function table(): Uint32Array {
  if (TABLE) return TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  TABLE = t;
  return t;
}

/** CRC-32 (the one ZIP uses). */
export function crc32(data: Uint8Array): number {
  const t = table();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS time and date (local time, two-second resolution, 1980 to 2107). */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Keeps a name safe inside the archive: forward slashes only, no leading slash, no "..", no empty parts. */
export function zipSafeName(name: string): string {
  const parts = name
    .replace(/\\/g, "/")
    .split("/")
    .map((p) => p.replace(/[\u0000-\u001f\u007f]/g, "").trim())
    .filter((p) => p !== "" && p !== "." && p !== "..");
  return parts.join("/") || "file";
}

/** Two files must not share a name in one archive: the second becomes "name (2).ext". */
export function uniqueZipNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  return names.map((raw) => {
    const name = zipSafeName(raw);
    let candidate = name;
    let n = 2;
    while (seen.has(candidate.toLowerCase())) {
      const dot = name.lastIndexOf(".");
      const slash = name.lastIndexOf("/");
      candidate = dot > slash + 1 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
      n += 1;
    }
    seen.add(candidate.toLowerCase());
    return candidate;
  });
}

export function createZip(entries: readonly ZipEntry[]): Uint8Array {
  if (entries.length > 0xffff) throw new Error("too many files for a ZIP archive");
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const { time, date } = dosDateTime(e.modified ?? new Date());
    if (e.data.length > 0xfffffffe || offset > 0xfffffffe) throw new Error("the archive is too large for the ZIP format");

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // flags: UTF-8 names
    lv.setUint16(8, 0, true); // method: stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, e.data.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true); // offset of the local header
    cd.set(name, 46);

    chunks.push(local, e.data);
    central.push(cd);
    offset += local.length + e.data.length;
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + cdSize + end.length);
  let at = 0;
  for (const c of [...chunks, ...central, end]) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
