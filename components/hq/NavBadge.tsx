/*
 * The small count after a nav label (Communications: new website enquiries), in the sidebar, the tab
 * bar and the More sheet. Nothing is rendered for null. Screen readers hear "3 new".
 */
export function NavBadge({ text, className }: { text: string | null | undefined; className: string }) {
  if (!text) return null;
  return (
    <span className={className}>
      {text}
      <span className="sr-only"> new</span>
    </span>
  );
}
