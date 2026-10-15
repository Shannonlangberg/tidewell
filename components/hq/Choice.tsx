import type { InputHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import { FieldError, fieldId } from "./Field";

/*
 * Checkbox, CheckboxGroup, RadioGroup: native inputs with a custom skin (a 4px box,
 * a hairline-grey edge that meets 3:1, a charcoal fill when checked). The whole row is
 * the label, so the touch target is 44px or more on phones.
 *
 * Groups are <fieldset><legend>, so a screen reader announces the question with each
 * option. RadioGroup has a `segmented` look (a joined row of options) for short lists
 * such as Received / Sent.
 */

export type ChoiceOption = { value: string; label: ReactNode; hint?: ReactNode; disabled?: boolean };

type ChoiceInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className" | "id" | "name">;

// ── Checkbox ────────────────────────────────────────────────

export type CheckboxProps = ChoiceInputProps & {
  name: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  /** The value posted when checked. Default "on" (what `FormReader.bool` reads). */
  value?: string;
  idPrefix?: string;
  className?: string;
};

export function Checkbox({ name, label, hint, error, value = "on", idPrefix, className, ...rest }: CheckboxProps) {
  const id = fieldId(name, idPrefix);
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={cx("hq-choicefield", className)}>
      <label className="hq-choice" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          name={name}
          value={value}
          className="hq-choice__input"
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
          {...rest}
        />
        <span className="hq-choice__text">
          <span className="hq-choice__label">{label}</span>
          {hint ? (
            <span id={hintId} className="hq-choice__hint">
              {hint}
            </span>
          ) : null}
        </span>
      </label>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}

// ── Group (shared by CheckboxGroup and RadioGroup) ─────────

type GroupBase = {
  name: string;
  legend: string;
  hint?: ReactNode;
  error?: string | null;
  options: readonly ChoiceOption[];
  required?: boolean;
  idPrefix?: string;
  className?: string;
  disabled?: boolean;
};

function Group({
  type,
  name,
  legend,
  hint,
  error,
  options,
  required,
  idPrefix,
  className,
  disabled,
  selected,
  segmented,
  inline,
}: GroupBase & { type: "checkbox" | "radio"; selected: readonly string[]; segmented?: boolean; inline?: boolean }) {
  const id = fieldId(name, idPrefix);
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <fieldset
      id={id}
      className={cx("hq-group", error && "hq-group--invalid", className)}
      aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
      disabled={disabled}
    >
      <legend className="hq-field__label">
        {legend}
        {required ? (
          <span className="hq-field__req" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
      </legend>
      {hint ? (
        <p id={hintId} className="hq-field__hint">
          {hint}
        </p>
      ) : null}
      <div className={cx("hq-group__options", segmented && "hq-group__options--segmented", inline && "hq-group__options--inline")}>
        {options.map((o) => {
          const oid = `${id}-${o.value}`;
          return (
            <label key={o.value} className={cx("hq-choice", segmented && "hq-choice--segment")} htmlFor={oid}>
              <input
                id={oid}
                type={type}
                name={name}
                value={o.value}
                defaultChecked={selected.includes(o.value)}
                disabled={o.disabled}
                required={type === "radio" ? required : undefined}
                aria-invalid={error ? true : undefined}
                className="hq-choice__input"
              />
              <span className="hq-choice__text">
                <span className="hq-choice__label">{o.label}</span>
                {o.hint ? <span className="hq-choice__hint">{o.hint}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </fieldset>
  );
}

export type CheckboxGroupProps = GroupBase & {
  /** Values checked to begin with. Posts every checked value under `name` (read with FormReader.manyOf). */
  defaultValue?: readonly string[];
  inline?: boolean;
};

export function CheckboxGroup({ defaultValue = [], inline, ...rest }: CheckboxGroupProps) {
  return <Group type="checkbox" selected={defaultValue} inline={inline} {...rest} />;
}

export type RadioGroupProps = GroupBase & {
  defaultValue?: string;
  /** A joined row of options instead of a vertical list. Best for 2 to 4 short options. */
  segmented?: boolean;
  inline?: boolean;
};

export function RadioGroup({ defaultValue, segmented, inline, ...rest }: RadioGroupProps) {
  return <Group type="radio" selected={defaultValue ? [defaultValue] : []} segmented={segmented} inline={inline} {...rest} />;
}
