import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button } from "@/components/hq/Button";
import { ErrorState } from "@/components/hq/EmptyState";
import { InlineNote, KeyValueList, SectionLabel } from "@/components/hq/Primitives";
import { AuthFrame } from "@/components/hq/features/auth/AuthFrame";
import { readSession } from "@/lib/auth";
import { currentStaffOrNull } from "@/lib/hq/auth";
import { consentLines, consentPath, isAuthorizationId, redirectHost, safeClientRedirect } from "@/lib/hq/mcp/consent";
import { getAuthorizationDetails } from "@/lib/hq/mcp/oauth-server";

export const metadata: Metadata = { title: "Connect an app" };
export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/*
 * The OAuth consent screen (docs/hq-mcp.md section 1). Supabase Auth sends the browser here
 * as /hq/oauth/consent?authorization_id=... when ChatGPT, Claude or another MCP client asks to
 * connect to Planted HQ.
 *
 *  - Not signed in (or the token is stale): through /api/session, which refreshes, or sends
 *    the person to HQ sign-in with this page as `next`, so they come straight back.
 *  - Signed in but not active staff, or without `ai.use` (read-only): told plainly, and can
 *    only cancel. A second step still owed: to /hq/mfa, then back here.
 *  - Already approved this app before: Supabase answers with the redirect; we follow it.
 *  - Otherwise: who is asking, where it will send you back to, what it can and cannot do,
 *    and Approve / Cancel, which post to ./decision (that route re-checks everything).
 */
export default async function ConsentPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const authorizationId = one(sp.authorization_id);

  if (!isAuthorizationId(authorizationId)) {
    return (
      <AuthFrame title="Connect an app" footer={<p>Start again from the app you were connecting, such as ChatGPT or Claude.</p>}>
        <ErrorState title="This link is not complete">This page is opened by the app you are connecting to Planted HQ. The link it used is missing a part.</ErrorState>
      </AuthFrame>
    );
  }

  const self = consentPath(authorizationId);
  const session = await readSession(self);
  const staff = await currentStaffOrNull(session);

  const cancelOnly = (title: string, body: string) => (
    <AuthFrame title="Connect an app" footer={<p>Planted HQ is the private staff portal for Planted Property Management.</p>}>
      <ErrorState title={title}>{body}</ErrorState>
      <DecisionForm authorizationId={authorizationId} allowApprove={false} />
    </AuthFrame>
  );

  if (!staff) return cancelOnly("This login does not have access", "Only members of the Planted team can connect an app to Planted HQ. If you think this is wrong, ask a director.");
  if (staff.mfaRequired && staff.aal !== "aal2") redirect(`/hq/mfa?next=${encodeURIComponent(self)}`);
  if (!staff.capabilities.includes("ai.use")) {
    return cancelOnly("Your role does not include connected apps", "Read-only access to Planted HQ does not include connecting ChatGPT, Claude or other apps. A director can change your role in People.");
  }

  const details = await getAuthorizationDetails(session.accessToken, authorizationId);
  if (details.kind === "already") {
    const to = safeClientRedirect(details.redirectUrl);
    if (to) redirect(to);
  }
  if (details.kind !== "consent") {
    const gone = details.kind === "gone";
    return (
      <AuthFrame title="Connect an app" footer={<p>Start again from the app you were connecting, such as ChatGPT or Claude.</p>}>
        <ErrorState title={gone ? "This request has expired" : "We could not load this request"}>
          {gone
            ? "Connection requests last a few minutes and work once. Go back to the app and connect again."
            : "Something went wrong on our side. Go back to the app and try connecting again in a moment."}
        </ErrorState>
      </AuthFrame>
    );
  }
  if (details.userId && details.userId !== session.claims.sub) {
    return cancelOnly("This request is for a different login", "Sign out of Planted HQ, then connect again from the app.");
  }

  const appName = details.client.name.trim() || "An app";
  const lines = consentLines(staff.capabilities);

  return (
    <AuthFrame
      title="Connect an app"
      lead={
        <>
          <strong className="font-semibold text-charcoal">{appName}</strong> wants to use Planted HQ as you, {staff.firstName}.
        </>
      }
      footer={
        <p>
          You can disconnect it at any time from your profile in Planted HQ, under Connected apps. Answers in a chat app can be wrong: check before acting on them.
        </p>
      }
    >
      {one(sp.failed) === "1" ? (
        <ErrorState title="That did not go through" className="mb-6">
          Your choice could not be saved. Try again, or go back to the app and connect again.
        </ErrorState>
      ) : null}
      <KeyValueList
        items={[
          { label: "App", value: appName },
          { label: "Website", value: details.client.uri || null, empty: "Not given" },
          { label: "Sends you back to", value: <span className="break-all">{details.redirectUri || "Not given"}</span> },
        ]}
      />
      {details.redirectUri ? (
        <p className="hq-muted mt-2 text-[13px]">
          The app chose its own name and website. After you choose, you go back to <span className="font-medium">{redirectHost(details.redirectUri)}</span>: only approve if that is the app you just asked to connect.
        </p>
      ) : null}

      <section aria-labelledby="can-h" className="mt-8">
        <SectionLabel as="h2" id="can-h" className="mb-2.5">
          It will be able to
        </SectionLabel>
        <ul className="grid list-disc gap-2 pl-5 text-[15px] leading-relaxed">
          {lines.can.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="cannot-h" className="mt-7">
        <SectionLabel as="h2" id="cannot-h" className="mb-2.5">
          It will not be able to
        </SectionLabel>
        <ul className="grid list-disc gap-2 pl-5 text-[15px] leading-relaxed">
          {lines.cannot.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>

      <InlineNote className="mt-7">Text in HQ records is passed to the app as information only. What the app does with your conversation is governed by that app&rsquo;s own terms.</InlineNote>

      <DecisionForm authorizationId={authorizationId} allowApprove />
    </AuthFrame>
  );
}

function DecisionForm({ authorizationId, allowApprove }: { authorizationId: string; allowApprove: boolean }) {
  return (
    <form method="post" action="/hq/oauth/consent/decision" className="mt-8 flex flex-wrap gap-3">
      <input type="hidden" name="authorization_id" value={authorizationId} />
      {allowApprove ? (
        <Button type="submit" name="decision" value="approve" variant="primary">
          Approve
        </Button>
      ) : null}
      <Button type="submit" name="decision" value="deny" variant="secondary">
        {allowApprove ? "Cancel" : "Cancel and go back"}
      </Button>
    </form>
  );
}
