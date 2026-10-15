/*
 * Creates the FIRST director of a real Planted HQ database.
 *
 *   npm run hq:bootstrap -- --email you@yourdomain --name "Full Name" --confirm
 *
 * Run it once, from your own machine, against the Supabase project you have set up for HQ.
 * It needs two environment variables, supplied by you on the command line or in a
 * `.env.production.local` file that is never committed:
 *
 *   NEXT_PUBLIC_SUPABASE_URL   the project URL
 *   SUPABASE_SECRET_KEY        the project's secret key (Settings, API Keys)
 *
 * What it does, and nothing more:
 *   1. Creates the sign-in (an Auth user) for that email. No password is set: people sign in
 *      with an emailed code, and the password route is refused by a database hook.
 *   2. Calls hq.bootstrap_first_director(), which refuses to run if ANY staff already exists.
 *   3. Prints what to do next.
 *
 * Every other person is invited from inside HQ (People, Invite) by an administrator.
 * Unlike the local seed this script is allowed to talk to a remote project, so it demands an
 * explicit --confirm and prints exactly which project it is about to change.
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const get = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const email = get("--email")?.trim().toLowerCase();
const fullName = get("--name")?.trim();
const confirmed = args.includes("--confirm");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;

function stop(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) stop('Pass a real address: --email you@yourdomain');
if (!fullName || fullName.length < 2) stop('Pass the person\'s full name: --name "Full Name"');
if (!url || !secret) stop("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY first (see the comment at the top of this file).");

const host = new URL(url).hostname;
const isLocal = ["127.0.0.1", "localhost"].includes(host);
console.log(`Project:  ${host}${isLocal ? "  (local development stack)" : ""}`);
console.log(`Director: ${fullName} <${email}>`);
if (!confirmed) stop("\nNothing has been changed. Re-run with --confirm to create this director on the project above.");

const firstName = fullName.split(/\s+/)[0];
const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

async function main() {
  const existing = await admin.schema("hq").from("staff_profiles").select("id", { count: "exact", head: true });
  if (existing.error) stop(`Could not read hq.staff_profiles (${existing.error.code}). Is the hq schema exposed and are the migrations applied?`);
  if ((existing.count ?? 0) > 0) stop("This project already has staff. Invite further people from inside HQ (People, Invite).");

  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: fullName, first_name: firstName },
  });
  if (created.error || !created.data.user) stop(`Could not create the sign-in: ${created.error?.message ?? "unknown error"}`);
  const userId = created.data.user.id;

  const { error } = await admin.schema("hq").rpc("bootstrap_first_director", {
    p_user_id: userId,
    p_email: email,
    p_full_name: fullName,
    p_first_name: firstName,
  });
  if (error) {
    // Do not leave an orphaned login behind.
    await admin.auth.admin.deleteUser(userId);
    stop(`bootstrap_first_director refused: ${error.message}`);
  }

  console.log("\nDone. The first director has been created.");
  console.log(`Next: open /hq, enter ${email}, and type the six-digit code that is emailed to you.`);
  console.log("HQ will then ask you to set up an authenticator app (multi-factor sign-in is required by default).");
}

main().catch((e) => stop(e instanceof Error ? e.message : String(e)));
