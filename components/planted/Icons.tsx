/*
 * Hairline icons drawn to the same grid as the rules in the layout: 1px stroke,
 * 32px box, no fill, no colour of their own. Architectural marks, not pictures.
 */

type IconProps = { className?: string };

const base = {
  width: 32,
  height: 32,
  viewBox: "0 0 32 32",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1,
  "aria-hidden": true as const,
};

/** Proactive property care: a roofline with a measured datum beneath it. */
export function IconCare({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3 14 16 4l13 10" />
      <path d="M7 17v11h18V17" />
      <path d="M3 28h26" />
      <path d="M13 28v-7h6v7" />
    </svg>
  );
}

/** Communication that matters: two lines in conversation. */
export function IconCommunication({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 6h17v12H11l-7 6V6Z" />
      <path d="M24 11h4v12l-4-3" />
      <path d="M9 11h7M9 14h4" />
    </svg>
  );
}

/** Local market knowledge: a coastline and a fixed point. */
export function IconLocal({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M2 24c4 0 4-3 8-3s4 3 8 3 4-3 8-3 4 3 6 3" />
      <circle cx="16" cy="11" r="3" />
      <path d="M16 18c3.5-4 6-6.5 6-9.5A6 6 0 0 0 10 8.5c0 3 2.5 5.5 6 9.5Z" />
    </svg>
  );
}

/** Modern management: a plan view with a clear reading. */
export function IconModern({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="4" y="5" width="24" height="18" />
      <path d="M4 11h24" />
      <path d="M12 11v12" />
      <path d="M4 27h24" />
      <path d="M16 15h8M16 19h5" />
    </svg>
  );
}

/** Reporting and visibility: a measured rise. */
export function IconReporting({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 4v24h24" />
      <path d="M8 22l6-7 5 4 9-11" />
      <path d="M28 8v5h-5" />
    </svg>
  );
}

/** Stewardship and protection. */
export function IconStewardship({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M16 3l11 4v9c0 7-4.6 11.2-11 13-6.4-1.8-11-6-11-13V7l11-4Z" />
      <path d="M11 16l4 4 7-8" />
    </svg>
  );
}
