import test from "node:test";
import assert from "node:assert/strict";
import { daysFromToday, formatDate, plural } from "../format.ts";
import { FormReader } from "../forms.ts";
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABEL,
  MAX_DOCUMENT_BYTES,
  buildStoragePath,
  expiryBadge,
  isStoragePathFor,
  readPrepareForm,
  readRegisterForm,
  readVerifyForm,
  sanitiseFileName,
  uploadProblem,
} from "./documents-rules.ts";

const CID = "6f0f4a9e-0d0e-4a6e-8a30-1f0b0c1d2e3f";
const DID = "1a2b3c4d-2222-4333-8444-55555555abcd";

const reader = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new FormReader(fd);
};

test("the three helpers written out in documents-rules match format.ts", () => {
  // expiryBadge is built on them: compare through its output.
  const today = "2026-10-15";
  assert.equal(daysFromToday("2026-10-20", today), 5);
  assert.equal(expiryBadge("2026-10-20", today, 30).label, `Expires in ${plural(5, "day")}`);
  assert.equal(expiryBadge("2027-03-12", today, 30).label, `Expires ${formatDate("2027-03-12")}`);
  assert.equal(expiryBadge("2026-10-14", today, 30).label, "Expired yesterday");
});

test("document types are the database enum and all labelled", () => {
  assert.equal(DOCUMENT_TYPES.length, 8);
  for (const t of DOCUMENT_TYPES) assert.ok(DOCUMENT_TYPE_LABEL[t]);
});

test("expiry badge wording at the boundaries (warning window 30 days)", () => {
  const today = "2026-10-15";
  assert.deepEqual(expiryBadge(null, today, 30), { tone: "neutral", label: "No expiry date", plain: true });
  assert.deepEqual(expiryBadge("2026-10-13", today, 30), { tone: "error", label: "Expired 2 days ago", plain: false });
  assert.deepEqual(expiryBadge("2026-10-14", today, 30), { tone: "error", label: "Expired yesterday", plain: false });
  // The expiry date itself is still valid: it is "today", a warning, not expired.
  assert.deepEqual(expiryBadge("2026-10-15", today, 30), { tone: "warning", label: "Expires today", plain: false });
  assert.deepEqual(expiryBadge("2026-10-16", today, 30), { tone: "warning", label: "Expires tomorrow", plain: false });
  assert.equal(expiryBadge("2026-11-14", today, 30).tone, "warning"); // day 30: still in the window
  assert.equal(expiryBadge("2026-11-14", today, 30).label, "Expires in 30 days");
  assert.equal(expiryBadge("2026-11-15", today, 30).tone, "neutral"); // day 31: a plain date
  assert.equal(expiryBadge("2026-11-15", today, 30).label, "Expires 15 Nov 2026");
});

test("a malformed expiry date reads as no expiry rather than throwing", () => {
  assert.equal(expiryBadge("garbage", "2026-10-15", 30).label, "No expiry date");
});

test("upload checks: types", () => {
  assert.equal(uploadProblem({ fileName: "licence.pdf", mimeType: "application/pdf", sizeBytes: 1000 }), null);
  assert.equal(uploadProblem({ fileName: "photo.JPG", mimeType: "image/jpeg", sizeBytes: 1000 }), null);
  assert.equal(uploadProblem({ fileName: "photo.jpeg", mimeType: "image/jpeg", sizeBytes: 1000 }), null);
  assert.equal(uploadProblem({ fileName: "scan.png", mimeType: "image/png", sizeBytes: 1000 }), null);
  assert.match(uploadProblem({ fileName: "a.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sizeBytes: 5 }) ?? "", /PDF, JPEG and PNG/);
  assert.match(uploadProblem({ fileName: "a.exe", mimeType: "", sizeBytes: 5 }) ?? "", /PDF, JPEG and PNG/);
  assert.match(uploadProblem({ fileName: "a.exe", mimeType: "application/pdf", sizeBytes: 5 }) ?? "", /does not match/);
  assert.match(uploadProblem({ fileName: "noext", mimeType: "application/pdf", sizeBytes: 5 }) ?? "", /does not match/);
});

test("upload checks: size and name", () => {
  assert.equal(uploadProblem({ fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: MAX_DOCUMENT_BYTES }), null);
  assert.match(uploadProblem({ fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: MAX_DOCUMENT_BYTES + 1 }) ?? "", /larger than 10 MB/);
  assert.match(uploadProblem({ fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 0 }) ?? "", /empty/);
  assert.match(uploadProblem({ fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: Number.NaN }) ?? "", /empty/);
  assert.match(uploadProblem({ fileName: "", mimeType: "application/pdf", sizeBytes: 5 }) ?? "", /Choose a file/);
  assert.match(uploadProblem({ fileName: `${"a".repeat(260)}.pdf`, mimeType: "application/pdf", sizeBytes: 5 }) ?? "", /too long/);
});

test("sanitised names only use A-Z a-z 0-9 . _ - and are 1 to 120 long", () => {
  const cases = ["Public Liability 2026.pdf", "../../etc/passwd", "C:\\Users\\me\\scan (1).png", "résumé.pdf", "....pdf", "  .  ", "a".repeat(300) + ".pdf", "日本語.pdf", ""];
  for (const c of cases) {
    const s = sanitiseFileName(c);
    assert.match(s, /^[A-Za-z0-9._-]{1,120}$/, `${JSON.stringify(c)} -> ${s}`);
    assert.ok(!s.startsWith("."), s);
  }
  assert.equal(sanitiseFileName("Public Liability 2026.pdf"), "Public-Liability-2026.pdf");
  assert.equal(sanitiseFileName("../../etc/passwd"), "passwd");
  assert.equal(sanitiseFileName("résumé.pdf"), "resume.pdf");
  assert.ok(sanitiseFileName("a".repeat(300) + ".pdf").endsWith(".pdf"));
});

test("storage paths have the exact shape the bucket policy and RPC accept", () => {
  const path = buildStoragePath(CID.toUpperCase(), DID, "My Licence.pdf");
  assert.equal(path, `${CID}/${DID}-My-Licence.pdf`);
  assert.ok(isStoragePathFor(CID, path));
  assert.ok(!isStoragePathFor(DID, path), "another contractor's folder is refused");
  assert.ok(!isStoragePathFor(CID, `${CID}/../${DID}-x.pdf`));
  assert.ok(!isStoragePathFor(CID, `${CID}/${DID}-${"a".repeat(121)}`));
  assert.ok(!isStoragePathFor(CID, `${CID}/not-a-uuid-x.pdf`));
  assert.ok(!isStoragePathFor(CID, `${CID}/${DID.toUpperCase()}-x.pdf`), "upper-case uuids are refused");
});

test("prepare form: reads, and refuses a bad file", () => {
  const good = reader({ contractor_id: CID, document_type: "licence", file_name: "l.pdf", mime_type: "application/pdf", size_bytes: "2048", expires_on: "2027-01-31", notes: " renewed " });
  const v = readPrepareForm(good);
  assert.deepEqual(v, { contractorId: CID, documentType: "licence", fileName: "l.pdf", mimeType: "application/pdf", sizeBytes: 2048, expiresOn: "2027-01-31", notes: "renewed" });

  const big = reader({ contractor_id: CID, document_type: "licence", file_name: "l.pdf", mime_type: "application/pdf", size_bytes: String(MAX_DOCUMENT_BYTES + 1) });
  assert.equal(readPrepareForm(big), null);
  assert.ok(big.errors.file);

  const noSize = reader({ contractor_id: CID, document_type: "licence", file_name: "l.pdf", mime_type: "application/pdf" });
  assert.equal(readPrepareForm(noSize), null);

  const badType = reader({ contractor_id: CID, document_type: "passport", file_name: "l.pdf", mime_type: "application/pdf", size_bytes: "5" });
  assert.equal(readPrepareForm(badType), null);
  assert.ok(badType.errors.document_type);

  const badDate = reader({ contractor_id: CID, document_type: "licence", file_name: "l.pdf", mime_type: "application/pdf", size_bytes: "5", expires_on: "2027-02-30" });
  assert.equal(readPrepareForm(badDate), null);
});

test("size must be digits: no scientific notation, no negatives", () => {
  for (const s of ["1e3", "-5", "5.5", "0x10"]) {
    const r = reader({ contractor_id: CID, document_type: "licence", file_name: "l.pdf", mime_type: "application/pdf", size_bytes: s });
    assert.equal(readPrepareForm(r), null, s);
  }
});

test("register form: the path must be in this contractor's folder", () => {
  const base = { contractor_id: CID, document_type: "licence", file_name: "l.pdf", mime_type: "application/pdf", size_bytes: "5" };
  assert.ok(readRegisterForm(reader({ ...base, storage_path: `${CID}/${DID}-l.pdf` })));
  const other = reader({ ...base, storage_path: `${DID}/${DID}-l.pdf` });
  assert.equal(readRegisterForm(other), null);
  assert.ok(other.errors.file);
  assert.equal(readRegisterForm(reader({ ...base })), null);
});

test("verify form: rejection needs a note; apply only travels with verified", () => {
  const rej = reader({ document_id: DID, verification: "rejected", note: "" });
  assert.equal(readVerifyForm(rej), null);
  assert.ok(rej.errors.note);
  assert.equal(readVerifyForm(reader({ document_id: DID, verification: "rejected", note: "Blurry scan" }))?.verification, "rejected");

  const ver = readVerifyForm(reader({ document_id: DID, verification: "verified", expires_on: "2027-05-01", apply_to_contractor: "on" }));
  assert.deepEqual(ver, { documentId: DID, verification: "verified", expiresOn: "2027-05-01", note: null, applyToContractor: true });

  const notVerified = readVerifyForm(reader({ document_id: DID, verification: "pending", apply_to_contractor: "on" }));
  assert.equal(notVerified?.applyToContractor, false);
  assert.equal(readVerifyForm(reader({ document_id: DID, verification: "approved" })), null);
});

test("file sizes read in plain units", async () => {
  const { formatBytes } = await import("./documents-rules.ts");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1024), "1 KB");
  assert.equal(formatBytes(250 * 1024), "250 KB");
  assert.equal(formatBytes(1.2 * 1024 * 1024), "1.2 MB");
  assert.equal(formatBytes(-1), "");
});
