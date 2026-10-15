"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { navKeyForPath, type NavKey } from "./nav";

/*
 * A navigation link that knows whether it is the current section.
 *
 * A shared layout cannot see the URL, so the shell cannot be handed `active` by the
 * layout. Each link works it out from the pathname instead, using the same
 * navKeyForPath() rule the rest of the shell uses (longest matching href wins, and
 * the dashboard lights only on /hq itself). `override` lets a page force a section.
 */
export function ActiveLink({
  navKey,
  override,
  ...props
}: Omit<ComponentProps<typeof Link>, "aria-current"> & { navKey: NavKey; override?: NavKey | null }) {
  const pathname = usePathname();
  const active = override !== undefined ? override : navKeyForPath(pathname);
  return <Link {...props} aria-current={active === navKey ? "page" : undefined} />;
}

/** The active section for the current URL, for client components that need the same answer. */
export function useActiveNavKey(override?: NavKey | null): NavKey | null {
  const pathname = usePathname();
  return override !== undefined ? override : navKeyForPath(pathname);
}
