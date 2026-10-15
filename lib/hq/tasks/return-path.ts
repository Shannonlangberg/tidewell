import { safeNextPath } from "../next-path";

/*
 * The one validator for a task form's `return` path: a same-origin path inside /hq, or null.
 * Built on lib/hq/next-path.ts (no other origin, no protocol-relative URL, no dot-segment
 * escape, never a sign-in screen, the fragment dropped). It lives apart from rules.ts only
 * because rules.ts, which is unit-tested under Node, cannot import its neighbours.
 */

export function safeReturnPath(value: unknown): string | null {
  const path = safeNextPath(value, "");
  return path === "" ? null : path;
}
