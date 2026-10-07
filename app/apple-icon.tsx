import { tagIcon } from "@/lib/icon";

// iOS applies its own corner mask, so this one is square.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";
export default function AppleIcon() {
  return tagIcon(180, false);
}
