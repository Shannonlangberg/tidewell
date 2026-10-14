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
];

const secretImportPatterns = [
  {
    group: ["**/lib/supabase/secret", "**/lib/supabase/secret.ts", "@/lib/supabase/secret"],
    message: "The secret key bypasses RLS. Only the routes listed in docs/backend-design.md section 6 may import lib/supabase/secret.ts.",
  },
];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", ".next-*/**", "out/**", "build/**", "next-env.d.ts", "design/**", "supabase/**"]),
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: secretImportPatterns }],
    },
  },
  {
    files: SECRET_KEY_ALLOWED,
    rules: {
      "no-restricted-imports": "off",
    },
  },
]);
