/*
 * Loads a researched contact file into HQ, acting as an existing director. Dry run by default.
 *
 *   node scripts/hq/load-research.mts --file ~/.planted-hq/research-2026-10.json --email you@yourdomain [--confirm]
 *
 * The data file is NOT kept in the repository (the repository is public and the file holds phone numbers and
 * emails). Shape: { source, contractors: [...], contacts: [...], organisations: [...] }, rows as accepted by
 * apply_contractor_import and apply_partner_import, plus organisation updates.
 *
 * Nothing is invented and nothing is overwritten: new records are created through the import functions
 * (everything arrives as a prospect / identified and "needs verifying"); for a record that already exists, only
 * blank fields are filled and any note is appended. Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 * and SUPABASE_SECRET_KEY (the last only to start the director's session, as `npm run hq:code` does).
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const get = (f: string) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : undefined);
const file = get("--file")?.replace(/^~/, homedir());
const email = get("--email")?.trim().toLowerCase();
const apply = args.includes("--confirm");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const pub = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
const stop = (m: string): never => {
  console.error(m);
  process.exit(1);
};
if (!file || !email) stop("Usage: --file <json> --email <director address> [--confirm]");
if (!url || !pub || !secret) stop("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY.");
console.log(`Project: ${new URL(url).hostname}   Mode: ${apply ? "APPLY" : "dry run (nothing written)"}`);

type Row = Record<string, unknown>;
const data = JSON.parse(readFileSync(file, "utf8")) as { source: string; contractors?: Row[]; contacts?: Row[]; organisations?: Row[] };
const key = (s: unknown) => String(s ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
const code = link.data?.properties?.email_otp;
if (!code) stop("Could not start the director's session.");
const me = createClient(url, pub, { auth: { persistSession: false, autoRefreshToken: false } });
const signed = await me.auth.verifyOtp({ email, token: code!, type: "email" });
if (signed.error) stop(`Sign-in failed: ${signed.error.message}`);
const hq = me.schema("hq");

const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";
function fill(existing: Row, wanted: Row, fields: string[]): Row {
  const patch: Row = {};
  for (const f of fields) if (!blank(wanted[f]) && blank(existing[f])) patch[f] = wanted[f];
  return patch;
}
function appendNote(existing: Row, note: unknown, field: string, patch: Row) {
  if (blank(note)) return;
  const cur = String(existing[field] ?? "");
  if (!cur.includes(String(note))) patch[field] = cur ? `${cur}\n${note}` : String(note);
}

// ── contractors ──────────────────────────────────────────────
const existingC = (await hq.from("contractors").select("*").is("deleted_at", null)).data ?? [];
const byKeyC = new Map(existingC.map((c) => [key(c.business_name), c]));
const newC: Row[] = [];
let updC = 0;
for (const r of data.contractors ?? []) {
  const ex = byKeyC.get(key(r.business_name));
  if (!ex) {
    newC.push({ ...r, notes: [r.notes, data.contractors && "Published details, not verified."].filter(Boolean).join(" ") });
    continue;
  }
  const patch = fill(ex, r, ["primary_contact_name", "phone", "email", "website"]);
  if (blank(ex.service_suburbs?.length ? "x" : "") && Array.isArray(r.service_suburbs)) patch.service_suburbs = r.service_suburbs;
  appendNote(ex, r.notes, "internal_notes", patch);
  if (Object.keys(patch).length) {
    updC += 1;
    console.log(`  update contractor: ${r.business_name}: ${Object.keys(patch).join(", ")}`);
    if (apply) {
      const u = await hq.from("contractors").update(patch).eq("id", ex.id);
      if (u.error) console.error(`    refused: ${u.error.code} ${u.error.message}`);
    }
  }
}
console.log(`Contractors: ${newC.length} to create, ${updC} existing to fill in.`);
if (newC.length) {
  const fn = apply ? "apply_contractor_import" : "preview_contractor_import";
  const res = await hq.rpc(fn, apply ? { p_rows: newC, p_source: data.source, p_file_name: "research file" } : { p_rows: newC });
  if (res.error) console.error("  import:", res.error.message, res.error.details ?? "");
  else console.log("  import counts:", JSON.stringify((res.data as Row).counts));
}

// ── referral contacts ────────────────────────────────────────
if (data.contacts?.length) {
  const fn = apply ? "apply_partner_import" : "preview_partner_import";
  const rows = data.contacts.map((r) => ({ ...r }));
  const res = await hq.rpc(fn, apply ? { p_rows: rows, p_source: data.source, p_file_name: "research file" } : { p_rows: rows });
  if (res.error) console.error("  partner import:", res.error.message, res.error.details ?? "");
  else console.log("Referral contacts, import counts:", JSON.stringify((res.data as Row).counts));
  const existing = (await hq.from("contacts").select("*").is("deleted_at", null)).data ?? [];
  const byName = new Map(existing.map((c) => [key(c.full_name), c]));
  let n = 0;
  for (const r of data.contacts) {
    const ex = byName.get(key(r.full_name));
    if (!ex) continue;
    const patch = fill(ex, r, ["phone", "email", "location", "website", "position"]);
    if (Object.keys(patch).length) {
      n += 1;
      console.log(`  fill in contact: ${r.full_name}: ${Object.keys(patch).join(", ")}`);
      if (apply) {
        const u = await hq.from("contacts").update(patch).eq("id", ex.id);
        if (u.error) console.error(`    refused: ${u.error.code} ${u.error.message}`);
      }
    }
  }
  console.log(`Referral contacts: ${n} existing records to fill in.`);
}

// ── referral organisations ───────────────────────────────────
for (const r of data.organisations ?? []) {
  const orgs = (await hq.from("organisations").select("*").is("deleted_at", null)).data ?? [];
  const ex = orgs.find((o) => key(o.name) === key(r.name));
  if (!ex) {
    console.log(`  organisation not found yet (created by the contacts import if it has people): ${r.name}`);
    continue;
  }
  const patch = fill(ex, r, ["phone", "email", "location"]);
  appendNote(ex, r.notes, "notes", patch);
  const cats = new Set<string>(ex.categories ?? []);
  for (const c of (r.categories as string[]) ?? []) cats.add(c);
  if (cats.size !== (ex.categories ?? []).length) patch.categories = [...cats];
  if (Object.keys(patch).length) {
    console.log(`  update organisation: ${r.name}: ${Object.keys(patch).join(", ")}`);
    if (apply) {
      const u = await hq.from("organisations").update(patch).eq("id", ex.id);
      if (u.error) console.error(`    refused: ${u.error.code} ${u.error.message}`);
    }
  }
}
await me.auth.signOut();
console.log(apply ? "Done." : "Dry run finished. Re-run with --confirm to write.");
