import type { ReactNode, SVGProps } from "react";

/*
 * HQ icon set: hairline geometric line icons on one 24px grid, 1.5px stroke, round
 * joins, no fill and no colour of their own (they take currentColor). One set,
 * drawn here, so nothing in HQ borrows a different icon style. Decorative by
 * default (`aria-hidden`); pass `title` to make one meaningful on its own.
 */

export type IconName =
  | "dashboard"
  | "growth"
  | "partners"
  | "operations"
  | "people"
  | "insights"
  | "search"
  | "plus"
  | "phone"
  | "calendar"
  | "mail"
  | "message"
  | "coffee"
  | "note"
  | "task"
  | "check"
  | "close"
  | "chevron-right"
  | "chevron-left"
  | "chevron-down"
  | "chevron-up"
  | "arrow-up-right"
  | "arrow-up"
  | "arrow-down"
  | "alert"
  | "info"
  | "filter"
  | "more"
  | "settings"
  | "user"
  | "sign-out"
  | "sparkle"
  | "building"
  | "link"
  | "clock"
  | "inbox";

const GLYPHS: Record<IconName, ReactNode> = {
  // Four panels of different heights: a layout, not a gauge.
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7" height="9" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="5" rx="1.5" />
      <rect x="13.5" y="11.5" width="7" height="9" rx="1.5" />
      <rect x="3.5" y="15.5" width="7" height="5" rx="1.5" />
    </>
  ),
  // A rising line with an arrowhead.
  growth: (
    <>
      <path d="M3.5 17.5 9 12l3.5 3.5 8-8" />
      <path d="M15 7.5h5.5V13" />
    </>
  ),
  // Two overlapping rings: a relationship.
  partners: (
    <>
      <circle cx="9" cy="12" r="5.5" />
      <circle cx="15" cy="12" r="5.5" />
    </>
  ),
  // A list with ticked and open rows.
  operations: (
    <>
      <path d="m4 6.5 1.5 1.5 2.5-3" />
      <path d="M11.5 6.5h8.5" />
      <path d="m4 12.5 1.5 1.5 2.5-3" />
      <path d="M11.5 12.5H20" />
      <rect x="4" y="16.5" width="4" height="4" rx="1" />
      <path d="M11.5 18.5H17" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19.5c0-3.2 2.4-5.5 5.5-5.5s5.5 2.3 5.5 5.5" />
      <circle cx="17" cy="9.5" r="2.25" />
      <path d="M16.6 14.2c2.4.2 3.9 1.9 3.9 4.6" />
    </>
  ),
  insights: (
    <>
      <path d="M4 20.5h16" />
      <path d="M6.5 17.5v-5" />
      <path d="M12 17.5V6" />
      <path d="M17.5 17.5V10" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5.5 5.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  // A handset: two ends joined by a curve.
  phone: <path d="M5.2 4.5h3l1.6 4-2.1 1.5a11.5 11.5 0 0 0 5.3 5.3l1.5-2.1 4 1.6v3A1.6 1.6 0 0 1 17.9 19.4C10.4 19.4 4.6 13.6 4.6 6.1A1.6 1.6 0 0 1 5.2 4.5Z" />,
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2" />
      <path d="M4 10h16" />
      <path d="M8.5 3.5v4M15.5 3.5v4" />
    </>
  ),
  mail: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="m4 7.5 8 5.5 8-5.5" />
    </>
  ),
  message: <path d="M6 4.5h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6.5L7 19.5V16.5H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" />,
  coffee: (
    <>
      <path d="M5 9.5h11v5a4.5 4.5 0 0 1-4.5 4.5h-2A4.5 4.5 0 0 1 5 14.5v-5Z" />
      <path d="M16 11h1.25a2.25 2.25 0 0 1 0 4.5H16" />
      <path d="M8.5 3.5v2.5M12.5 3.5v2.5" />
    </>
  ),
  note: (
    <>
      <path d="M7 3.5h7l5 5V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z" />
      <path d="M14 3.5V9h5" />
      <path d="M9 13h6M9 16.5h4" />
    </>
  ),
  task: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="m8.5 12.25 2.5 2.5 4.5-5" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  "chevron-right": <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />,
  "chevron-left": <path d="M14.5 5.5 8 12l6.5 6.5" />,
  "chevron-down": <path d="m5.5 9.5 6.5 6.5 6.5-6.5" />,
  "chevron-up": <path d="m5.5 14.5 6.5-6.5 6.5 6.5" />,
  "arrow-up-right": (
    <>
      <path d="M7 17 17 7" />
      <path d="M8.5 7H17v8.5" />
    </>
  ),
  "arrow-up": (
    <>
      <path d="M12 19V5" />
      <path d="m6 11 6-6 6 6" />
    </>
  ),
  "arrow-down": (
    <>
      <path d="M12 5v14" />
      <path d="m6 13 6 6 6-6" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.75v5" />
      <path d="M12 16.1v.1" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <path d="M12 7.9v.1" />
    </>
  ),
  filter: <path d="M4 6.5h16M7 12h10M10 17.5h4" />,
  more: (
    <>
      <circle cx="5.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  // Two sliders: precise, and not a cog.
  settings: (
    <>
      <path d="M4 7h8.5M17.5 7H20" />
      <circle cx="15" cy="7" r="2.5" />
      <path d="M4 17h2.5M11.5 17H20" />
      <circle cx="9" cy="17" r="2.5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c0-3.8 3.1-6.5 7-6.5s7 2.7 7 6.5" />
    </>
  ),
  "sign-out": (
    <>
      <path d="M10 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10" />
      <path d="m14.5 8 4 4-4 4" />
      <path d="M18.5 12H9.5" />
    </>
  ),
  // A concave four-point sparkle with a small companion. Geometric, not a star.
  sparkle: (
    <>
      <path d="M10.5 4c.7 4.6 3.1 7 7.5 7.5-4.4.5-6.8 2.9-7.5 7.5-.7-4.6-3.1-7-7.5-7.5C7.4 11 9.8 8.6 10.5 4Z" />
      <path d="M18.5 3v3.5M16.75 4.75h3.5" />
    </>
  ),
  building: (
    <>
      <path d="M5.5 20.5V4.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v16" />
      <path d="M14.5 9.5h3a1 1 0 0 1 1 1v10" />
      <path d="M3.5 20.5h17" />
      <path d="M9 7.5h2M9 11h2M9 14.5h2" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 13.5 6.5 5.5h11l2.5 8" />
      <path d="M4 13.5V18a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 18v-4.5h-4.5a3.5 3.5 0 0 1-7 0H4Z" />
    </>
  ),
};

export type IconProps = Omit<SVGProps<SVGSVGElement>, "name" | "children"> & {
  name: IconName;
  /** Pixel size of the square icon. Default 20. */
  size?: number;
  /** Gives the icon an accessible name. Omit for decorative icons (the default). */
  title?: string;
};

export function Icon({ name, size = 20, title, className, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      focusable="false"
      {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
      {...rest}
    >
      {GLYPHS[name]}
    </svg>
  );
}

type NamedProps = Omit<IconProps, "name">;
const make = (name: IconName) => {
  const Named = (props: NamedProps) => <Icon name={name} {...props} />;
  Named.displayName = `Icon(${name})`;
  return Named;
};

export const DashboardIcon = make("dashboard");
export const GrowthIcon = make("growth");
export const PartnersIcon = make("partners");
export const OperationsIcon = make("operations");
export const PeopleIcon = make("people");
export const InsightsIcon = make("insights");
export const SearchIcon = make("search");
export const PlusIcon = make("plus");
export const PhoneIcon = make("phone");
export const CalendarIcon = make("calendar");
export const MailIcon = make("mail");
export const MessageIcon = make("message");
export const CoffeeIcon = make("coffee");
export const NoteIcon = make("note");
export const TaskIcon = make("task");
export const CheckIcon = make("check");
export const CloseIcon = make("close");
export const ChevronRightIcon = make("chevron-right");
export const ChevronLeftIcon = make("chevron-left");
export const ChevronDownIcon = make("chevron-down");
export const ChevronUpIcon = make("chevron-up");
export const ArrowUpRightIcon = make("arrow-up-right");
export const ArrowUpIcon = make("arrow-up");
export const ArrowDownIcon = make("arrow-down");
export const AlertIcon = make("alert");
export const InfoIcon = make("info");
export const FilterIcon = make("filter");
export const MoreIcon = make("more");
export const SettingsIcon = make("settings");
export const UserIcon = make("user");
export const SignOutIcon = make("sign-out");
export const SparkleIcon = make("sparkle");
export const BuildingIcon = make("building");
export const LinkIcon = make("link");
export const ClockIcon = make("clock");
export const InboxIcon = make("inbox");
