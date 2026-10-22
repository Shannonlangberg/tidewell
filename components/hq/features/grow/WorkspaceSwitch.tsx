import Link from "next/link";
import { buttonClass } from "@/components/hq/Button";
import { WORKSPACE_LABEL, WORKSPACE_SHORT, type Workspace } from "@/lib/hq/workspaces";
import { saveWorkspace } from "./actions";

/*
 * The switch at the top of Today between the workspaces this person may use (lib/hq/workspaces.ts). Plain
 * links (?view=), so Back works and nothing is saved by looking. "Make this my default" saves the one
 * showing as the person's own preference; it never changes what they may see.
 */
export function WorkspaceSwitch({ offered, current, home }: { offered: readonly Workspace[]; current: Workspace; home: Workspace }) {
  if (offered.length < 2) return null;
  return (
    <div className="hq-ws">
      <nav className="hq-ws__switch" aria-label="Workspace">
        {offered.map((w) => (
          <Link key={w} href={`/hq?view=${w}`} className="hq-ws__opt" aria-current={w === current ? "page" : undefined} scroll={false}>
            <span className="hq-ws__long">{WORKSPACE_LABEL[w]}</span>
            <span className="hq-ws__short" aria-hidden="true">
              {WORKSPACE_SHORT[w]}
            </span>
          </Link>
        ))}
      </nav>
      {current !== home ? (
        <form action={saveWorkspace} className="hq-ws__save">
          <input type="hidden" name="workspace" value={current} />
          <span>Today opens in {WORKSPACE_LABEL[home]}.</span>
          <button type="submit" className={buttonClass({ size: "sm" })}>
            Make this my default
          </button>
        </form>
      ) : null}
    </div>
  );
}
