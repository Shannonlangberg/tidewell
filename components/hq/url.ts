/*
 * URL helpers for link-based sorting, filtering, tabs and pagination. Pure, so they
 * work in Server and Client Components alike. A page passes its resolved
 * `searchParams` object straight in.
 */

export type SearchParamsInput = Record<string, string | string[] | undefined> | URLSearchParams;

function entriesOf(input: SearchParamsInput | undefined): Array<[string, string]> {
  if (!input) return [];
  if (input instanceof URLSearchParams) return [...input.entries()];
  const out: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) for (const v of value) out.push([key, v]);
    else if (value !== undefined) out.push([key, value]);
  }
  return out;
}

/**
 * `pathname` plus the current search params with `overrides` applied. An override of
 * null, undefined or "" removes that param. Everything else is preserved.
 */
export function buildHref(
  pathname: string,
  current: SearchParamsInput | undefined,
  overrides: Record<string, string | number | null | undefined> = {},
): string {
  const params = new URLSearchParams();
  for (const [k, v] of entriesOf(current)) {
    if (!(k in overrides)) params.append(k, v);
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== null && v !== undefined && v !== "") params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
