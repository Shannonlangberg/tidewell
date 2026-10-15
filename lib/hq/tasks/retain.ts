/*
 * What a Server Action hands back so a form can show again exactly what the person typed.
 *
 * React 19 resets an uncontrolled form when its action finishes, so after a failed submit the
 * typed values come back in `ActionState.data.values` and are passed to each field as its
 * defaultValue (see the retained-input note in components/hq/dev/GalleryDemos.tsx). Files and
 * Next's own "$ACTION_..." bookkeeping fields are never echoed back.
 *
 * Pure and dependency-free.
 */

export type RetainedValues = Record<string, string>;

const MAX_VALUE = 5000;

export function retainedValues(formData: FormData): RetainedValues {
  const out: RetainedValues = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$") || typeof value !== "string") continue;
    if (!(key in out)) out[key] = value.slice(0, MAX_VALUE);
  }
  return out;
}
