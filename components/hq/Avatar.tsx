import { initials } from "@/lib/hq/format";
import { cx } from "./cx";

/*
 * Initials in a circle. A circle is one of only two places the brand allows one (the
 * other is the mobile floating button). Decorative by default, because the person's
 * name is almost always shown beside it; pass `label` when it stands alone.
 */

export type AvatarProps = {
  name: string;
  size?: "sm" | "md" | "lg";
  /** For use on the charcoal sidebar. */
  onDark?: boolean;
  /** Accessible name when the avatar is not next to the person's name. */
  label?: string;
  className?: string;
};

export function Avatar({ name, size = "md", onDark, label, className }: AvatarProps) {
  return (
    <span
      className={cx("hq-avatar", size !== "md" && `hq-avatar--${size}`, onDark && "hq-avatar--dark", className)}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {initials(name)}
    </span>
  );
}
