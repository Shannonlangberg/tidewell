/*
 * Dated and people-bearing seed for a LOCAL or branch database (design section 10).
 * Never against production: it refuses any host that is not 127.0.0.1 / localhost
 * unless SEED_ALLOW_REMOTE=1 is set on purpose.
 *
 * Run: npm run seed:local   (node --env-file=.env.local supabase/seed.mts)
 *
 * Phase 0 scope: the people and owner accounts the sign-in flow needs. Homes,
 * bookings, jobs and the rest arrive with their phases. Idempotent: existing
 * users, accounts and memberships are left alone.
 *
 * Auth users are created through the admin API with user_metadata names; the
 * `on_auth_user_created` trigger builds the profiles row from them. Accounts and
 * memberships are written with the secret key (RLS bypassed, triggers still run;
 * the memberships guard exempts rows written with no session, which is how the
 * founders' manager rows are created).
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required (see .env.example).");
  process.exit(1);
}
const host = new URL(url).hostname;
if (!["127.0.0.1", "localhost"].includes(host) && process.env.SEED_ALLOW_REMOTE !== "1") {
  console.error(`Refusing to seed ${host}: this script is for the local stack. Set SEED_ALLOW_REMOTE=1 only for a branch database.`);
  process.exit(1);
}

const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

type Person = {
  key: string;
  email: string;
  full_name: string;
  first_name: string;
  roles: Array<
    | { role: "owner"; account: string; primary?: boolean }
    | { role: "crew"; crew_kind: "cleaner" | "tradie" }
    | { role: "manager" }
  >;
};

type Account = {
  key: string;
  display_name: string;
  billing_email: string;
  approval_threshold_cents: number;
  contact_method: string;
  contact_cadence: string;
  prefs: string[];
  pm?: string; // person key
};

// Thresholds and preferences mirror lib/demo.ts and lib/humanTouch.ts so the demo screens still read true.
const ACCOUNTS: Account[] = [
  { key: "pelham", display_name: "Jane Pelham", billing_email: "jane.pelham@example.test", approval_threshold_cents: 15000, contact_method: "text", contact_cadence: "monthly", prefs: ["Text for minor updates", "Call before anything over $150", "Monthly phone call", "Evenings suit best"], pm: "court" },
  { key: "tait", display_name: "Rob and Alison Tait", billing_email: "rob.tait@example.test", approval_threshold_cents: 30000, contact_method: "phone", contact_cadence: "monthly", prefs: ["Call, don't text", "Call before maintenance over $300", "Quarterly performance review", "Rob handles money, Alison handles the house"], pm: "shannon" },
  { key: "castellano", display_name: "Mia Castellano", billing_email: "mia.castellano@example.test", approval_threshold_cents: 20000, contact_method: "phone", contact_cadence: "monthly", prefs: ["Call for anything guest-related"], pm: "court" },
];

const PEOPLE: Person[] = [
  { key: "jane", email: "jane.pelham@example.test", full_name: "Jane Pelham", first_name: "Jane", roles: [{ role: "owner", account: "pelham", primary: true }] },
  { key: "rob", email: "rob.tait@example.test", full_name: "Rob Tait", first_name: "Rob", roles: [{ role: "owner", account: "tait", primary: true }] },
  { key: "alison", email: "alison.tait@example.test", full_name: "Alison Tait", first_name: "Alison", roles: [{ role: "owner", account: "tait" }] },
  { key: "mia", email: "mia.castellano@example.test", full_name: "Mia Castellano", first_name: "Mia", roles: [{ role: "owner", account: "castellano", primary: true }] },
  { key: "kel", email: "kel.brennan@example.test", full_name: "Kel Brennan", first_name: "Kel", roles: [{ role: "crew", crew_kind: "cleaner" }] },
  { key: "dean", email: "dean.ashby@example.test", full_name: "Dean Ashby", first_name: "Dean", roles: [{ role: "crew", crew_kind: "tradie" }] },
  { key: "court", email: "court@example.test", full_name: "Court", first_name: "Court", roles: [{ role: "manager" }] },
  // A founder who is both manager and owner, which the design says must work (decision 3).
  { key: "shannon", email: "shannon@example.test", full_name: "Shannon", first_name: "Shannon", roles: [{ role: "manager" }, { role: "owner", account: "castellano" }] },
];

function fail(step: string, error: { message: string } | null): never {
  console.error(`${step}: ${error?.message ?? "unknown error"}`);
  process.exit(1);
}

async function ensureUser(p: Person): Promise<string> {
  // listUsers is paginated; the seed world is far below one page.
  const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (error) fail("listUsers", error);
  const existing = data.users.find((u) => u.email?.toLowerCase() === p.email);
  if (existing) return existing.id;
  const created = await db.auth.admin.createUser({
    email: p.email,
    email_confirm: true,
    user_metadata: { full_name: p.full_name, first_name: p.first_name },
  });
  if (created.error || !created.data.user) fail(`createUser ${p.email}`, created.error);
  return created.data.user.id;
}

async function ensureAccount(a: Account, pmId: string | null): Promise<string> {
  const found = await db.from("owner_accounts").select("id").eq("display_name", a.display_name).maybeSingle();
  if (found.error) fail(`owner_accounts lookup ${a.key}`, found.error);
  if (found.data) return found.data.id as string;
  const ins = await db
    .from("owner_accounts")
    .insert({
      display_name: a.display_name,
      billing_email: a.billing_email,
      approval_threshold_cents: a.approval_threshold_cents,
      contact_method: a.contact_method,
      contact_cadence: a.contact_cadence,
      prefs: a.prefs,
      pm_user_id: pmId,
      started_at: new Date().toISOString().slice(0, 10),
    })
    .select("id")
    .single();
  if (ins.error) fail(`owner_accounts insert ${a.key}`, ins.error);
  return ins.data.id as string;
}

async function ensureMembership(row: Record<string, unknown>, label: string) {
  let q = db.from("memberships").select("id").eq("user_id", row.user_id as string).eq("role", row.role as string);
  q = row.owner_account_id ? q.eq("owner_account_id", row.owner_account_id as string) : q.is("owner_account_id", null);
  const found = await q.neq("status", "ended").maybeSingle();
  if (found.error) fail(`memberships lookup ${label}`, found.error);
  if (found.data) return;
  const ins = await db.from("memberships").insert({ status: "active", ...row });
  if (ins.error) fail(`memberships insert ${label}`, ins.error);
}

async function main() {
  const userIds = new Map<string, string>();
  for (const p of PEOPLE) userIds.set(p.key, await ensureUser(p));

  const accountIds = new Map<string, string>();
  for (const a of ACCOUNTS) accountIds.set(a.key, await ensureAccount(a, a.pm ? (userIds.get(a.pm) ?? null) : null));

  // Managers first so the founders exist before anyone else's rows reference a pm.
  for (const p of PEOPLE) {
    const uid = userIds.get(p.key)!;
    for (const r of p.roles) {
      if (r.role === "manager") await ensureMembership({ user_id: uid, role: "manager" }, `${p.key} manager`);
    }
  }
  for (const p of PEOPLE) {
    const uid = userIds.get(p.key)!;
    for (const r of p.roles) {
      if (r.role === "owner") {
        await ensureMembership(
          { user_id: uid, role: "owner", owner_account_id: accountIds.get(r.account)!, is_primary_contact: r.primary === true },
          `${p.key} owner of ${r.account}`,
        );
      } else if (r.role === "crew") {
        await ensureMembership({ user_id: uid, role: "crew", crew_kind: r.crew_kind }, `${p.key} ${r.crew_kind}`);
      }
    }
  }

  const counts = await Promise.all([
    db.from("profiles").select("id", { count: "exact", head: true }),
    db.from("owner_accounts").select("id", { count: "exact", head: true }),
    db.from("memberships").select("id", { count: "exact", head: true }),
  ]);
  console.log(`Seeded ${host}: ${counts[0].count} profiles, ${counts[1].count} owner accounts, ${counts[2].count} memberships.`);
  console.log("Sign in locally with any seeded address (codes land in Mailpit at http://127.0.0.1:54324):");
  for (const p of PEOPLE) console.log(`  ${p.email.padEnd(32)} ${p.roles.map((r) => (r.role === "crew" ? r.crew_kind : r.role)).join(" + ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
