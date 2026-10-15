/*
 * Prints a snippet that signs the browser in as a seeded local user, with no email step.
 *   npm run hq:session -- shannon@planted.test
 *
 * Paste the output into the browser console on any localhost page, then open /hq.
 * LOCAL ONLY. It mints an ordinary Supabase session, so row level security applies exactly
 * as after a real sign-in. The cookie matches the one @supabase/ssr writes.
 */
import { createChunks, stringToBase64URL } from "@supabase/ssr";
import { requireLocal, sessionFor, url } from "./lib.mts";

requireLocal();
const email = process.argv[2];
if (!email) {
  console.error("Usage: npm run hq:session -- <email>   (for example shannon@planted.test)");
  process.exit(1);
}

const session = await sessionFor(email);
const name = `sb-${new URL(url!).hostname.split(".")[0]}-auth-token`;
const encoded = `base64-${stringToBase64URL(JSON.stringify(session))}`;
const chunks = createChunks(name, encoded);

const lines = chunks.map((c) => `document.cookie = ${JSON.stringify(`${c.name}=${c.value}; path=/; max-age=3600; samesite=lax`)};`);
console.log(`// Signed in as ${email}. Paste into the browser console, then open /hq\n${lines.join("\n")}\nlocation.href = "/hq";`);
