import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cx } from "./cx";
import { Field, type FieldShared } from "./Field";
import { Icon } from "./icons";

/*
 * TextInput, Textarea, DateInput: native controls inside a Field. 4px radius, a
 * 3:1 control edge (--planted-grey), 44px tall on phones, 16px text on phones so iOS
 * does not zoom on focus.
 *
 * Keyboard and autofill: the right `type` and `inputMode` are set from `type`, and
 * `autoComplete` DEFAULTS TO "off" because HQ forms describe OTHER people (a contact's
 * email is not the signed-in person's). Pass autoComplete explicitly where it is the
 * person's own data (sign-in: "email", "one-time-code").
 */

type TextType = "text" | "email" | "tel" | "url" | "search" | "number" | "password";

const INPUT_MODE: Partial<Record<TextType, InputHTMLAttributes<HTMLInputElement>["inputMode"]>> = {
  email: "email",
  tel: "tel",
  url: "url",
  search: "search",
  number: "decimal",
};

export type TextInputProps = FieldShared &
  Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "name" | "type" | "className" | "required"> & {
    type?: TextType;
  };

export function TextInput({
  name,
  label,
  hint,
  error,
  required,
  hideLabel,
  idPrefix,
  className,
  type = "text",
  autoComplete = "off",
  inputMode,
  ...rest
}: TextInputProps) {
  const urlish = type === "email" || type === "url";
  return (
    <Field name={name} label={label} hint={hint} error={error} required={required} hideLabel={hideLabel} idPrefix={idPrefix} className={className}>
      {(a11y) => (
        <input
          {...a11y}
          name={name}
          type={type}
          inputMode={inputMode ?? INPUT_MODE[type]}
          autoComplete={autoComplete}
          autoCapitalize={urlish ? "none" : undefined}
          spellCheck={urlish ? false : undefined}
          className="hq-input"
          {...rest}
        />
      )}
    </Field>
  );
}

/** A search box with a leading magnifier, for filter bars. Posts `name` (default "q"). */
export function SearchInput({
  name = "q",
  label = "Search",
  hideLabel = true,
  idPrefix,
  className,
  placeholder,
  defaultValue,
}: {
  name?: string;
  label?: string;
  hideLabel?: boolean;
  idPrefix?: string;
  className?: string;
  placeholder?: string;
  defaultValue?: string;
}) {
  return (
    <Field name={name} label={label} hideLabel={hideLabel} idPrefix={idPrefix} className={cx("hq-field--search", className)}>
      {(a11y) => (
        <span className="hq-search">
          <Icon name="search" size={16} className="hq-search__icon" />
          <input
            {...a11y}
            name={name}
            type="search"
            inputMode="search"
            autoComplete="off"
            placeholder={placeholder}
            className="hq-input hq-input--search"
            defaultValue={defaultValue}
          />
        </span>
      )}
    </Field>
  );
}

export type TextareaProps = FieldShared & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "name" | "className" | "required">;

export function Textarea({ name, label, hint, error, required, hideLabel, idPrefix, className, rows = 4, autoComplete = "off", ...rest }: TextareaProps) {
  return (
    <Field name={name} label={label} hint={hint} error={error} required={required} hideLabel={hideLabel} idPrefix={idPrefix} className={className}>
      {(a11y) => <textarea {...a11y} name={name} rows={rows} autoComplete={autoComplete} className="hq-input hq-textarea" {...rest} />}
    </Field>
  );
}

export type DateInputProps = FieldShared &
  Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "name" | "type" | "className" | "required"> & {
    /** YYYY-MM-DD */
    min?: string;
    max?: string;
  };

/** The browser's own date picker. Posts YYYY-MM-DD, which FormReader.date() validates. */
export function DateInput({ name, label, hint, error, required, hideLabel, idPrefix, className, ...rest }: DateInputProps) {
  return (
    <Field name={name} label={label} hint={hint} error={error} required={required} hideLabel={hideLabel} idPrefix={idPrefix} className={className}>
      {(a11y) => <input {...a11y} name={name} type="date" autoComplete="off" className="hq-input hq-input--date" {...rest} />}
    </Field>
  );
}
