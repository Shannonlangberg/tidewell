/*
 * Local development seed for Planted HQ.  npm run hq:seed
 *
 * Creates a handful of clearly fake `.test` staff logins (never real addresses), makes
 * Shannon the first director through the same bootstrap function a real launch uses,
 * adds the rest through the add_staff RPC as that director, creates the Copper Coast
 * pod, switches MFA off for local convenience, imports the research leads from
 * hq/seed/referral-contacts.json through the duplicate-safe partner import, and the
 * maintenance contractor prospects from hq/seed/maintenance-contractors.json through the
 * duplicate-safe contractor import (as the director: import.run + contractors.write).
 *
 * Idempotent: run it again and nothing is duplicated.
 * Never runs against anything but the local stack. For a real launch use
 * scripts/hq/bootstrap-director.mts instead.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { adminClient, asUser, findUserId, requireLocal, sessionFor } from "./lib.mts";

requireLocal();
const admin = adminClient();

type Person = { email: string; full: string; first: string; role: string; note: string };
const PEOPLE: Person[] = [
  { email: "shannon@planted.test", full: "Shannon Langberg", first: "Shannon", role: "director", note: "Founder, Director, Business Development" },
  { email: "courtney@planted.test", full: "Courtney Langberg", first: "Courtney", role: "director", note: "Co-founder, Property Management, Operations" },
  // Test personas so permissions can be exercised. Clearly not real people.
  { email: "va@planted.test", full: "Test Virtual Assistant", first: "Test", role: "virtual_assistant", note: "dev persona" },
  { email: "readonly@planted.test", full: "Test Read-Only", first: "Test", role: "read_only", note: "dev persona" },
  { email: "junior@planted.test", full: "Test Junior PM", first: "Test", role: "junior_property_manager", note: "dev persona" },
];

async function ensureUser(p: Person): Promise<string> {
  const existing = await findUserId(p.email);
  if (existing) return existing;
  const { data, error } = await admin.auth.admin.createUser({
    email: p.email,
    email_confirm: true,
    user_metadata: { full_name: p.full, first_name: p.first },
  });
  if (error || !data.user) throw new Error(`createUser ${p.email}: ${error?.message}`);
  return data.user.id;
}

function sql(statement: string): void {
  // Local database only (the guard above). Used for the one setting a director cannot
  // change before being able to sign in.
  execFileSync("docker", ["exec", "supabase_db_Tidewell", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-c", statement], { stdio: "pipe" });
}

async function main() {
  const ids = new Map<string, string>();
  for (const p of PEOPLE) ids.set(p.email, await ensureUser(p));

  // MFA off for local development. Production keeps it on (the migration default).
  sql("update hq.settings set value = 'false'::jsonb where key = 'require_mfa'");

  // The first director: only possible while nobody exists, and only via the service role.
  const existing = await admin.schema("hq").from("staff_profiles").select("id", { count: "exact", head: true });
  if ((existing.count ?? 0) === 0) {
    const first = PEOPLE[0];
    const { error } = await admin.schema("hq").rpc("bootstrap_first_director", {
      p_user_id: ids.get(first.email)!,
      p_email: first.email,
      p_full_name: first.full,
      p_first_name: first.first,
    });
    if (error) throw new Error(`bootstrap_first_director: ${error.message}`);
    console.log(`Bootstrapped first director: ${first.full}`);
  }

  // Everyone else is added the way a real administrator would add them.
  const session = await sessionFor(PEOPLE[0].email);
  const db = asUser(session.access_token);

  for (const p of PEOPLE.slice(1)) {
    const id = ids.get(p.email)!;
    const have = await db.from("staff_profiles").select("id").eq("id", id).maybeSingle();
    if (have.data) continue;
    const { error } = await db.rpc("add_staff", { p_user_id: id, p_email: p.email, p_full_name: p.full, p_role: p.role, p_first_name: p.first, p_responsibilities: p.note });
    if (error) throw new Error(`add_staff ${p.email}: ${error.message}`);
    console.log(`Added ${p.full} (${p.role})`);
  }

  // The first pod, and the two founders in it.
  let pod = await db.from("pods").select("id").eq("name", "Copper Coast").maybeSingle();
  if (!pod.data) {
    const ins = await db.from("pods").insert({ name: "Copper Coast", region: "Copper Coast, South Australia" }).select("id").single();
    if (ins.error) throw new Error(`pods insert: ${ins.error.message}`);
    pod = { data: ins.data, error: null, count: null, status: 201, statusText: "Created" } as typeof pod;
  }
  for (const p of PEOPLE.slice(0, 2)) {
    const { error } = await db.rpc("update_staff", { p_staff_id: ids.get(p.email)!, p_pod: pod.data!.id, p_responsibilities: p.note });
    if (error) throw new Error(`update_staff ${p.email}: ${error.message}`);
  }

  // The research leads, through the duplicate-safe import.
  const file = JSON.parse(readFileSync("hq/seed/referral-contacts.json", "utf8")) as { source: string; rows: Record<string, unknown>[] };
  const imp = await db.rpc("apply_partner_import", { p_rows: file.rows, p_source: file.source, p_file_name: "referral-contacts.json" });
  if (imp.error) throw new Error(`apply_partner_import: ${imp.error.message}`);
  const counts = (imp.data as { counts: Record<string, number> }).counts;
  console.log(`Import: ${counts.organisations_created} organisations and ${counts.contacts_created} contacts created, ${counts.skipped} skipped, ${counts.possible_duplicate} possible duplicates reported.`);

  // The maintenance contractor prospects, through the duplicate-safe contractor import. Every row
  // arrives as a prospect that needs verification; a second run creates nothing (duplicates).
  const prospects = JSON.parse(readFileSync("hq/seed/maintenance-contractors.json", "utf8")) as { source: string; rows: Record<string, unknown>[] };
  const cimp = await db.rpc("apply_contractor_import", { p_rows: prospects.rows, p_source: prospects.source, p_file_name: "maintenance-contractors.json" });
  if (cimp.error) throw new Error(`apply_contractor_import: ${cimp.error.message}`);
  const ccounts = (cimp.data as { counts: Record<string, number> }).counts;
  console.log(`Contractor import: ${ccounts.contractors_created} contractors created, ${ccounts.skipped} skipped, ${ccounts.possible_duplicate} possible duplicates reported (${ccounts.rows} rows).`);

  console.log("\nLocal HQ logins (fake .test addresses; MFA is off locally):");
  for (const p of PEOPLE) console.log(`  ${p.email.padEnd(24)} ${p.role.padEnd(26)} ${p.full}`);
  console.log("\nSign in at http://localhost:3210/hq/sign-in (codes appear in Mailpit, http://127.0.0.1:54324),");
  console.log("or skip the email with: npm run hq:session -- shannon@planted.test");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
