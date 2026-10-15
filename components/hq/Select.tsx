import type { SelectHTMLAttributes } from "react";
import { Field, type FieldShared } from "./Field";
import { Icon } from "./icons";

/*
 * Select and NativeSelectPicker: both are a NATIVE <select> inside a Field, so
 * they work with the keyboard, on phones (the OS picker), with autofill and with no
 * JavaScript. A native `<input list>` is deliberately NOT used for choosing a record,
 * because it posts the typed text, not the id.
 *
 *  - Select: a fixed list from lib/hq/constants (status, category, priority).
 *  - NativeSelectPicker: choosing a RECORD by its id (a contact, an organisation, a
 *    staff member). Options may be grouped (`group`), rendered as <optgroup>. It always
 *    has a first "Choose..." option with value "", so an untouched field posts "" and
 *    `FormReader.uuid(..., { required: true })` reports "This is required".
 *
 * Both are keyed on `defaultValue`: React updates a <select>'s defaultValue only on
 * mount, so without the key a form that React 19 resets after a failed action would drop
 * the person's choice. Pass the submitted value back as defaultValue and it survives.
 */

export type SelectOption = { value: string; label: string; disabled?: boolean };
export type PickerOption = SelectOption & {
  /** Becomes an <optgroup label>. Options without one come first, ungrouped. */
  group?: string;
};

type SelectBase = FieldShared &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "name" | "className" | "required" | "children">;

function Chevron() {
  return <Icon name="chevron-down" size={16} className="hq-select__chev" />;
}

export type SelectProps = SelectBase & {
  options: readonly SelectOption[];
  /** Adds a first option with value "" and this label ("Any status", "Choose a category"). */
  placeholder?: string;
};

export function Select({ name, label, hint, error, required, hideLabel, idPrefix, className, options, placeholder, ...rest }: SelectProps) {
  return (
    <Field name={name} label={label} hint={hint} error={error} required={required} hideLabel={hideLabel} idPrefix={idPrefix} className={className}>
      {(a11y) => (
        <span className="hq-select">
          <select key={String(rest.defaultValue ?? "")} {...a11y} name={name} className="hq-input hq-input--select" {...rest}>
            {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
            {options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </select>
          <Chevron />
        </span>
      )}
    </Field>
  );
}

export type NativeSelectPickerProps = SelectBase & {
  options: readonly PickerOption[];
  /** The label of the empty first option. Default "Choose...". */
  placeholder?: string;
};

export function NativeSelectPicker({
  name,
  label,
  hint,
  error,
  required,
  hideLabel,
  idPrefix,
  className,
  options,
  placeholder = "Choose…",
  ...rest
}: NativeSelectPickerProps) {
  const ungrouped = options.filter((o) => !o.group);
  const groups: Array<[string, PickerOption[]]> = [];
  for (const o of options) {
    if (!o.group) continue;
    const found = groups.find(([g]) => g === o.group);
    if (found) found[1].push(o);
    else groups.push([o.group, [o]]);
  }
  return (
    <Field name={name} label={label} hint={hint} error={error} required={required} hideLabel={hideLabel} idPrefix={idPrefix} className={className}>
      {(a11y) => (
        <span className="hq-select">
          <select key={String(rest.defaultValue ?? "")} {...a11y} name={name} className="hq-input hq-input--select" {...rest}>
            <option value="">{placeholder}</option>
            {ungrouped.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
            {groups.map(([group, items]) => (
              <optgroup key={group} label={group}>
                {items.map((o) => (
                  <option key={o.value} value={o.value} disabled={o.disabled}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <Chevron />
        </span>
      )}
    </Field>
  );
}
