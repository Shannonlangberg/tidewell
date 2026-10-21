// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createZip, crc32, uniqueZipNames, zipSafeName } from "./zip.ts";

const enc = new TextEncoder();

/** Reads the archive back the way an unzipper does: the end record, the central directory, then each local header. */
function parse(zip: Uint8Array) {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  assert.equal(dv.getUint32(zip.length - 22, true), 0x06054b50, "end of central directory signature");
  const count = dv.getUint16(zip.length - 22 + 10, true);
  const cdSize = dv.getUint32(zip.length - 22 + 12, true);
  const cdOffset = dv.getUint32(zip.length - 22 + 16, true);
  assert.equal(cdOffset + cdSize, zip.length - 22);
  const out: Array<{ name: string; data: Uint8Array; crc: number }> = [];
  let at = cdOffset;
  for (let i = 0; i < count; i += 1) {
    assert.equal(dv.getUint32(at, true), 0x02014b50);
    const crc = dv.getUint32(at + 16, true);
    const size = dv.getUint32(at + 24, true);
    const nameLen = dv.getUint16(at + 28, true);
    const local = dv.getUint32(at + 42, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLen));
    assert.equal(dv.getUint32(local, true), 0x04034b50);
    assert.equal(dv.getUint16(local + 8, true), 0, "stored, not compressed");
    assert.equal(dv.getUint16(local + 6, true) & 0x0800, 0x0800, "UTF-8 names");
    const lnLen = dv.getUint16(local + 26, true);
    const start = local + 30 + lnLen;
    out.push({ name, data: zip.subarray(start, start + size), crc });
    at += 46 + nameLen;
  }
  return out;
}

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(enc.encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test("a zip holds every file, byte for byte, with the right CRC and names", () => {
  const files = [
    { name: "Logos/planted-lockup-forest.svg", data: enc.encode("<svg/>") },
    { name: "Guidelines/Brand Guidelines.html", data: enc.encode("<h1>café</h1>") },
    { name: "Photos/empty.txt", data: new Uint8Array(0) },
    { name: "Other/binary.bin", data: Uint8Array.from({ length: 70_000 }, (_, i) => (i * 7) % 256) },
  ];
  const got = parse(createZip(files));
  assert.equal(got.length, files.length);
  for (const [i, f] of files.entries()) {
    assert.equal(got[i].name, f.name);
    assert.deepEqual([...got[i].data], [...f.data]);
    assert.equal(got[i].crc, crc32(f.data));
  }
});

test("an empty archive is valid", () => {
  const z = createZip([]);
  assert.equal(z.length, 22);
  assert.equal(parse(z).length, 0);
});

test("names are kept safe inside the archive", () => {
  assert.equal(zipSafeName("../../etc/passwd"), "etc/passwd");
  assert.equal(zipSafeName("/abs/path.txt"), "abs/path.txt");
  assert.equal(zipSafeName("a\\b\\c.txt"), "a/b/c.txt");
  assert.equal(zipSafeName("a//b/./c"), "a/b/c");
  assert.equal(zipSafeName(".."), "file");
  assert.equal(zipSafeName("bad\u0000name.txt"), "badname.txt");
  assert.deepEqual(uniqueZipNames(["a/x.svg", "a/x.svg", "A/X.svg", "a/y.svg", "a/noext", "a/noext"]), ["a/x.svg", "a/x (2).svg", "A/X (3).svg", "a/y.svg", "a/noext", "a/noext (2)"]);
});

test("the real unzip tool accepts the archive and reads the same bytes back", { skip: spawnSync("unzip", ["-v"]).error ? "unzip is not installed" : false }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "zip-test-"));
  try {
    const file = path.join(dir, "t.zip");
    const data = Uint8Array.from({ length: 5000 }, (_, i) => i % 251);
    writeFileSync(file, createZip([{ name: "Logos/a b.svg", data }, { name: "INDEX.txt", data: enc.encode("hello\n") }]));
    const test = spawnSync("unzip", ["-t", file], { encoding: "utf8" });
    assert.equal(test.status, 0, test.stdout + test.stderr);
    assert.match(test.stdout, /No errors detected/);
    const cat = spawnSync("unzip", ["-p", file, "INDEX.txt"], { encoding: "utf8" });
    assert.equal(cat.stdout, "hello\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
