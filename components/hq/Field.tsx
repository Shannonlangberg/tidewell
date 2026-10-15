import type { ReactNode } from "react";
import type { ActionState } from "@/lib/hq/forms";
import { cx } from "./cx";
import { Icon } from "./icons";

/*
 * Field: label above, optional hint, optional error, and ALL the wiring:
 *   - <label for> matches the control's id,
 *   - hint and error are linked with aria-describedby,
 *   - aria-invalid is set while there is an error,
 *   - required is visible (an asterisk) and semantic (`required` + aria-required).
 *
 * The ready-made controls (TextInput, Textarea, Select, NativeSelectPicker, DateInput)
 * already use Field, so you rarely call it yourself. Use it with a render prop for a
 * custom control:
 *
 *   <Field name="amount" label="Amount" error={err}>
 *     {(a11y) => <input name="amount" {...a11y} />}
 *   </Field>
 *
 * IDS: a control's id is `${idPrefix}-${name}` (prefix defaults to "f"). FormSummary
 * links to the same ids. If one page holds two forms with the same field names, give
 * each form its own `idPrefix` (and pass it to its FormSummary).
 *
 * Server-safe: no state, no hooks.
 *
 * Errors come from `ActionState.fieldErrors`; use `fieldError(state, name)` below.
 *
 * NOTE for pages using useActionState: React 19 resets an uncontrolled form after its
 * action finishes, so after a failed submit return the submitted values in
 * `ActionState.data` and pass them back as `defaultValue`.
 */

export function fieldId(name: string, idPrefix = "f"): string {
  return `${idPrefix}-${name}`;
}

/** The message for one field from a Server Action's result, or undefined. */
export function fieldError(state: ActionState | null | undefined, name: string): string | undefined {
  return state?.fieldErrors?.[name];
}

/** The attributes a control must spread on itself. */
export type ControlA11y = {
  id: string;
  required?: boolean;
  "aria-required"?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

/** Props shared by every ready-made field. */
export type FieldShared = {
  /** Posted name, and the basis of the id. */
  name: string;
  label: string;
  hint?: ReactNode;
  /** The message to show. Usually `fieldError(state, name)`. */
  error?: string | null;
  required?: boolean;
  /** Keep the label for screen readers but hide it visually (filter bars). */
  hideLabel?: boolean;
  idPrefix?: string;
  className?: string;
};

export type FieldProps = Omit<FieldShared, "name"> & {
  name: string;
  /** Override the generated id. */
  id?: string;
  children: (a11y: ControlA11y) => ReactNode;
};

export function Field({ name, id, idPrefix, label, hint, error, required, hideLabel, className, children }: FieldProps) {
  const controlId = id ?? fieldId(name, idPrefix);
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cx("hq-field", error && "hq-field--invalid", className)}>
      <label htmlFor={controlId} className={cx("hq-field__label", hideLabel && "sr-only")}>
        {label}
        {required ? (
          <span className="hq-field__req" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
      </label>
      {hint ? (
        <p id={hintId} className="hq-field__hint">
          {hint}
        </p>
      ) : null}
      {children({
        id: controlId,
        required: required || undefined,
        "aria-required": required || undefined,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}

export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="hq-field__error">
      <Icon name="alert" size={15} />
      <span>
        <span className="sr-only">Error: </span>
        {children}
      </span>
    </p>
  );
}

/** The row of buttons that ends a form: a hairline above, secondary then primary, stacked on phones with the primary first. */
export function FormActions({ children, className, align = "end" }: { children: ReactNode; className?: string; align?: "start" | "end" | "between" }) {
  return <div className={cx("hq-formactions", `hq-formactions--${align}`, className)}>{children}</div>;
}
