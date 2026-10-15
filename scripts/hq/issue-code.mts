/*
 * Break-glass: issues a one-time sign-in code for an existing HQ staff member WITHOUT sending email.
 *
 *   node scripts/hq/issue-code.mts --email you@yourdomain --confirm
 *
 * Use it while no email sender is connected to the Supabase project (the free plan cannot send the
 * branded six-digit code on its own; see docs/hq-setup.md). Run it from a machine that holds the
 * project's secret key, after the person has asked for a code on the sign-in page, and give them the
 * six digits. The code is the same kind the emailed one is: ten minutes, used once, and the person
 * still has to pass multi-factor sign-in afterwards.
 *
 * It only works for someone who is already active HQ staff, copies the code to the clipboard on a Mac
 * (so it need not be read aloud or pasted into a chat), and refuses without --confirm. It is no more
 * powerful than the secret key it needs, which can already do everything; its job is to leave a
 * clear, deliberate step instead of a console one-liner.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (a .env.production.local that is never
 * committed, or the command line).
 */
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const get = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const email = get("--email")?.trim().toLowerCase();
const confirmed = args.includes("--confirm");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;

function stop(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!email) stop("Pass the person's address: --email you@yourdomain");
if (!url || !secret) stop("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY first (see the comment at the top of this file).");
console.log(`Project: ${new URL(url).hostname}`);
if (!confirmed) stop("Nothing has been issued. Re-run with --confirm.");

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

const staff = await admin.schema("hq").from("staff_profiles").select("id, is_active, employment_status").eq("email", email).maybeSingle();
if (staff.error) stop(`Could not read hq.staff_profiles (${staff.error.code ?? "unknown"}).`);
if (!staff.data || !staff.data.is_active || staff.data.employment_status !== "active") stop("That address is not active HQ staff. No code issued.");

const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
const code = link.data?.properties?.email_otp;
if (link.error || !code) stop(`Could not issue a code: ${link.error?.message ?? "no code returned"}`);

if (process.platform === "darwin") {
  const copied = spawnSync("pbcopy", { input: code });
  if (copied.status === 0) {
    console.log("A six-digit code for that person is on this Mac's clipboard (valid for ten minutes, one use).");
    process.exit(0);
  }
}
console.log(`Code (valid for ten minutes, one use): ${code}`);
