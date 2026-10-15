import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./icons";

/*
 * Buttons. Primary is charcoal with ivory text; secondary is transparent with a
 * charcoal border; ghost is text only; danger uses the functional error tokens.
 * `onDark` is for the charcoal header and sidebar. Radius is 4px (set in hq.css).
 *
 * Server-safe (no state). For a button that submits a Server Action and shows its
 * own pending state, use SubmitButton.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

type Look = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to the full width of its container. */
  block?: boolean;
  /** Use on the charcoal header or sidebar (outlined in taupe, ivory text). */
  onDark?: boolean;
  /** A hairline icon before the label. */
  icon?: IconName;
  /** A hairline icon after the label. */
  trailingIcon?: IconName;
};

export function buttonClass({ variant = "secondary", size = "md", block, onDark, className }: Look & { className?: string }) {
  return cx(
    "hq-btn",
    `hq-btn--${variant}`,
    size === "sm" && "hq-btn--sm",
    block && "hq-btn--block",
    onDark && "hq-btn--on-dark",
    className,
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("hq-spinner", className)} aria-hidden="true" />;
}

function Label({ icon, trailingIcon, children, size }: Pick<Look, "icon" | "trailingIcon" | "size"> & { children?: ReactNode }) {
  const px = size === "sm" ? 15 : 17;
  return (
    <span className="hq-btn__label">
      {icon ? <Icon name={icon} size={px} /> : null}
      {children}
      {trailingIcon ? <Icon name={trailingIcon} size={px} /> : null}
    </span>
  );
}

export type ButtonProps = Look &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
    /** Shows a spinner, keeps the width, and blocks further clicks. Use `pendingLabel` to tell screen readers what is happening. */
    loading?: boolean;
    pendingLabel?: string;
    className?: string;
  };

export function Button({
  variant = "secondary",
  size = "md",
  block,
  onDark,
  icon,
  trailingIcon,
  loading = false,
  pendingLabel,
  className,
  type = "button",
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass({ variant, size, block, onDark, className })}
      // While loading the button is natively disabled: no click can reach it, and Button
      // stays usable from Server Components (it attaches no handler of its own).
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      <Label icon={icon} trailingIcon={trailingIcon} size={size}>
        {children}
      </Label>
      {loading ? (
        <span className="hq-btn__spinner">
          <Spinner />
          {pendingLabel ? <span className="sr-only">{pendingLabel}</span> : null}
        </span>
      ) : null}
    </button>
  );
}

export type LinkButtonProps = Look &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "href"> & {
    href: string;
    /** Plain anchor instead of next/link: for downloads, mailto: and tel:. */
    external?: boolean;
    className?: string;
  };

export function LinkButton({
  href,
  variant = "secondary",
  size = "md",
  block,
  onDark,
  icon,
  trailingIcon,
  external,
  className,
  children,
  ...rest
}: LinkButtonProps) {
  const classes = buttonClass({ variant, size, block, onDark, className });
  const inner = (
    <Label icon={icon} trailingIcon={trailingIcon} size={size}>
      {children}
    </Label>
  );
  if (external || /^(mailto:|tel:|https?:)/.test(href)) {
    return (
      <a href={href} className={classes} {...rest}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={classes} {...rest}>
      {inner}
    </Link>
  );
}

export type IconButtonProps = Omit<ButtonProps, "icon" | "trailingIcon" | "children" | "pendingLabel"> & {
  icon: IconName;
  /** Required: an icon-only button has no other accessible name. */
  label: string;
  iconSize?: number;
};

export function IconButton({ icon, label, iconSize = 18, variant = "ghost", size = "md", className, ...rest }: IconButtonProps) {
  return (
    <Button variant={variant} size={size} className={cx("hq-iconbtn", className)} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={iconSize} />
    </Button>
  );
}
