import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * The secret-key boundary (docs/backend-design.md section 6): only these files
 * may import `lib/supabase/secret.ts`. Everything else gets the publishable key
 * and RLS. Add a path here only with a review of why RLS cannot decide.
 */
const SECRET_KEY_ALLOWED = [
  "lib/supabase/secret.ts",
  "app/api/enquiry/**",
  "app/api/members/**",
  "app/api/photos/sign/**",
  "app/api/documents/**",
  "app/api/ical/[token]/**",
  "app/stay/[token]/page.tsx",
  "app/stay/[token]/actions.ts",
  // Planted HQ: the Auth admin API only (creating a staff login on invitation). All HQ
  // data access runs as the signed-in person under row level security, never with this key.
  "lib/hq/staff-admin.ts",
  // Website enquiries: the public forms' Server Actions store an enquiry in HQ through this file, which only
  // calls hq.submit_enquiry (granted to service_role alone; the database validates, dedupes and rate-limits).
  // No visitor has an HQ session, so RLS cannot decide; the function is the boundary.
  "lib/hq/enquiry-intake.ts",
];

const secretImportPatterns = [
  {
    group: ["**/lib/supabase/secret", "**/lib/supabase/secret.ts", "@/lib/supabase/secret"],
    message: "The secret key bypasses RLS. Only the routes listed in docs/backend-design.md section 6 may import lib/supabase/secret.ts.",
  },
];

/**
 * The email-provider boundary (docs/hq-setup.md, Email): SENDGRID_API_KEY is read ONLY in
 * lib/hq/email/sendgrid.ts, and only lib/hq/email/send.ts (which sends an approved draft through
 * begin_email_send / finish_email_send, as the signed-in person) and lib/hq/email/enquiry-notify.ts (the
 * staff notice for a stored website enquiry, to ENQUIRY_TO_EMAIL only) may import that file.
 */
const EMAIL_PROVIDER_FILE = "lib/hq/email/sendgrid.ts";
// lib/hq/email/enquiry-notify.ts sends the staff notice for a stored website enquiry to ENQUIRY_TO_EMAIL only.
const EMAIL_PROVIDER_IMPORTERS = ["lib/hq/email/send.ts", "lib/hq/email/enquiry-notify.ts"];

const emailProviderImportPatterns = [
  {
    group: ["**/email/sendgrid", "**/email/sendgrid.ts", "@/lib/hq/email/sendgrid", "./sendgrid", "./sendgrid.ts"],
    message: "Only lib/hq/email/send.ts and lib/hq/email/enquiry-notify.ts may import the SendGrid provider (it holds the API key). Send through sendDraft() in lib/hq/email/send.ts.",
  },
];

const sendGridKeySyntax = [
  {
    selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='SENDGRID_API_KEY']",
    message: "SENDGRID_API_KEY is read only in lib/hq/email/sendgrid.ts.",
  },
  {
    selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.value='SENDGRID_API_KEY']",
    message: "SENDGRID_API_KEY is read only in lib/hq/email/sendgrid.ts.",
  },
];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", ".next-*/**", "out/**", "build/**", "next-env.d.ts", "design/**", "supabase/**"]),
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [...secretImportPatterns, ...emailProviderImportPatterns] }],
      "no-restricted-syntax": ["error", ...sendGridKeySyntax],
    },
  },
  {
    files: SECRET_KEY_ALLOWED,
    rules: {
      "no-restricted-imports": ["error", { patterns: emailProviderImportPatterns }],
    },
  },
  {
    files: EMAIL_PROVIDER_IMPORTERS,
    rules: {
      "no-restricted-imports": ["error", { patterns: secretImportPatterns }],
    },
  },
  {
    files: [EMAIL_PROVIDER_FILE],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
]);
