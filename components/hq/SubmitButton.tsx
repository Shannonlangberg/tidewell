"use client";

import type { ButtonHTMLAttributes } from "react";
import { useFormStatus } from "react-dom";
import { Spinner, buttonClass, type ButtonSize, type ButtonVariant } from "./Button";
import { cx } from "./cx";
import { Icon, type IconName } from "./icons";

/*
 * A submit button that knows when its form is pending (a Server Action, or a
 * `useActionState` action). While pending it shows a spinner, keeps its exact width
 * (the label stays in the layout, hidden), and ignores further clicks. It uses
 * aria-disabled rather than `disabled` so keyboard focus is not thrown away mid-submit.
 *
 * It must be rendered INSIDE the <form> it submits (useFormStatus reads the nearest form).
 */

export type SubmitButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "className"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  onDark?: boolean;
  icon?: IconName;
  /** Read out to screen readers while pending, e.g. "Saving contact". */
  pendingLabel?: string;
  className?: string;
};

export function SubmitButton({
  variant = "primary",
  size = "md",
  block,
  onDark,
  icon,
  pendingLabel = "Working",
  className,
  children,
  onClick,
  ...rest
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  const px = size === "sm" ? 15 : 17;
  return (
    <button
      type="submit"
      className={cx(buttonClass({ variant, size, block, onDark }), className)}
      aria-busy={pending || undefined}
      aria-disabled={pending || rest.disabled || undefined}
      {...rest}
      onClick={(e) => {
        if (pending) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
    >
      <span className="hq-btn__label">
        {icon ? <Icon name={icon} size={px} /> : null}
        {children}
      </span>
      {pending ? (
        <span className="hq-btn__spinner">
          <Spinner />
          <span className="sr-only" role="status">
            {pendingLabel}
          </span>
        </span>
      ) : null}
    </button>
  );
}
