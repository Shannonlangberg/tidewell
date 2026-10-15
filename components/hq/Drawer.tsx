"use client";

import { useId, type ReactNode } from "react";
import { cx } from "./cx";
import { IconButton } from "./Button";
import { useModalDialog } from "./useModalDialog";

/*
 * Drawer: a native <dialog> opened with showModal(), so the browser provides the focus
 * trap, the inert page behind it, Esc to close and the top layer. The component adds:
 * focus restored to the opener, a click on the backdrop closes, the page does not
 * scroll behind it (hq.css), and a slide that stops under prefers-reduced-motion.
 *
 * Placement: "auto" slides in from the right at 768px and up and is a bottom sheet
 * below that; "bottom" is always a sheet (the mobile More menu). It is controlled:
 *
 *   const [open, setOpen] = useState(false);
 *   <Button onClick={() => setOpen(true)}>Open</Button>
 *   <Drawer open={open} onClose={() => setOpen(false)} title="Log a call">...</Drawer>
 *
 * The title is the dialog's accessible name. Content scrolls inside the body; `footer`
 * stays pinned (put the form's actions there).
 */

export type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  /** One quiet line under the title. */
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  placement?: "auto" | "bottom";
  width?: "md" | "lg";
  /** Set false to block Esc and backdrop close while something is saving. */
  dismissible?: boolean;
  className?: string;
};

export function Drawer({ open, onClose, title, description, children, footer, placement = "auto", width = "md", dismissible = true, className }: DrawerProps) {
  const { ref, handlers } = useModalDialog(open, onClose, { dismissible });
  const titleId = useId();
  const descId = useId();
  return (
    <dialog
      ref={ref}
      className={cx("hq-modal hq-drawer", className)}
      data-placement={placement}
      data-width={width}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      {...handlers}
    >
      <div className="hq-drawer__panel">
        <div className="hq-drawer__head">
          <div className="hq-drawer__heading">
            <h2 id={titleId} className="hq-drawer__title">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="hq-drawer__desc">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton icon="close" label="Close" onClick={onClose} className="hq-drawer__close" />
        </div>
        <div className="hq-drawer__body">{children}</div>
        {footer ? <div className="hq-drawer__foot">{footer}</div> : null}
      </div>
    </dialog>
  );
}
