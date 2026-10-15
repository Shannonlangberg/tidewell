/*
 * What a Server Action hands back so a form can show again exactly what the person typed.
 *
 * React 19 resets an uncontrolled form when its action finishes, so after a failed submit the
 * values must come back in `ActionState.data` and be passed to each field as its defaultValue
 * (see the note in components/hq/Field.tsx). A name that appears more than once (a group of
 * checkboxes) comes back as an array.
 *
 * Pure and dependency-free.
 */

export type RetainedValues = Record<string, string | string[]>;

const MAX_VALUE = 5000;

export function retainedValues(formData: FormData): RetainedValues {
  const out: RetainedValues = {};
  for (const [key, value] of formData.entries()) {
    // Next adds "$ACTION_..." bookkeeping fields; files are never echoed back.
    if (key.startsWith("$") || typeof value !== "string") continue;
    const v = value.slice(0, MAX_VALUE);
    const prev = out[key];
    if (prev === undefined) out[key] = v;
    else out[key] = Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return out;
}

/** One value as text from retained values, or a fallback. */
export function retainedText(values: RetainedValues | undefined, name: string, fallback = ""): string {
  const v = values?.[name];
  if (Array.isArray(v)) return v[0] ?? fallback;
  return v ?? fallback;
}

/** All values of a repeated field. */
export function retainedList(values: RetainedValues | undefined, name: string, fallback: readonly string[] = []): readonly string[] {
  const v = values?.[name];
  if (v === undefined) return fallback;
  return Array.isArray(v) ? v : [v];
}
