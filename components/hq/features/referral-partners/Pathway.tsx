import Link from "next/link";
import { RELATIONSHIP_LABEL } from "@/lib/hq/constants";
import { PATHWAY_STEPS, STEP_HINT, STEP_LABEL, nextStep, placeOf, planPartnerMove, previousStep, type PathwayStep } from "@/lib/hq/growth/pathway";
import type { Loaded, PartnerPathway, PartnerRef } from "@/lib/hq/growth/pathway-queries";
import { HQ_ROUTES } from "../../nav";
import { cx } from "../../cx";
import { PathwayMoveButton, type MoveChangeView } from "./PathwayMove";

/*
 * "Referral pathway" on a partner's page: where they are on Not yet connected, Connect, Cultivate,
 * Champion (lib/hq/growth/pathway.ts), who sets it, and the moves to the next and previous step. The
 * place is read from the people's relationship status, the same way the Referral partners list reads it,
 * so the two always agree.
 */

function changesFor(people: PartnerPathway["people"], to: PathwayStep): MoveChangeView[] | null {
  const plan = planPartnerMove(people, to);
  if (!plan.ok) return null;
  return plan.changes.map((c) => ({ id: c.id, name: c.name, from: c.from ? RELATIONSHIP_LABEL[c.from] : "No status", to: RELATIONSHIP_LABEL[c.to] }));
}

export function PartnerPathwayPanel({
  partner,
  name,
  pathway,
  canWrite,
  returnTo,
}: {
  partner: PartnerRef;
  name: string;
  pathway: Loaded<PartnerPathway>;
  canWrite: boolean;
  returnTo: string;
}) {
  if (!pathway.ok) {
    return (
      <section className="hq-path" aria-labelledby="pathway-h">
        <h2 id="pathway-h" className="hq-path__label">
          Referral pathway
        </h2>
        <p className="hq-path__note">The pathway could not be loaded just now. Reload the page to try again.</p>
      </section>
    );
  }
  const { place, people } = pathway.data;
  const live = people.filter((p) => p.status !== "inactive");
  const setter =
    partner.kind === "organisation" && place !== "not_connected" && place !== "inactive"
      ? [...live].sort((a, b) => rankOf(b.status) - rankOf(a.status))[0]
      : null;
  const next = nextStep(place);
  const prev = previousStep(place);
  const nextChanges = next ? changesFor(people, next) : null;
  const prevChanges = prev ? changesFor(people, prev) : null;
  const filterHref = (s: string) => `${HQ_ROUTES.referralPartners}?stage=${s}${partner.kind === "independent" ? "&show=independent" : ""}`;

  return (
    <section className="hq-path" aria-labelledby="pathway-h">
      <div className="hq-path__head">
        <h2 id="pathway-h" className="hq-path__label">
          Referral pathway
        </h2>
        <Link href={filterHref(place)} className="hq-path__all">
          Everyone at {STEP_LABEL[place]}
        </Link>
      </div>
      <ol className="hq-path__track" aria-label={`${name} is at ${STEP_LABEL[place]}`}>
        {PATHWAY_STEPS.map((s, i) => {
          const at = place === s;
          const passed = place !== "inactive" && PATHWAY_STEPS.indexOf(place) > i;
          return (
            <li key={s} className={cx("hq-path__step", at && "hq-path__step--here", passed && "hq-path__step--done")} aria-current={at ? "step" : undefined}>
              <span className="hq-path__name">{STEP_LABEL[s]}</span>
              <span className="hq-path__hint">{STEP_HINT[s]}</span>
              {at ? <span className="hq-path__here">Here now</span> : null}
            </li>
          );
        })}
      </ol>
      <p className="hq-path__note">
        {place === "inactive"
          ? "Not active: everyone recorded here is marked inactive. Change a person's status on their page to bring them back."
          : people.length === 0
            ? "Not yet connected: nobody is recorded here yet. Add the person you deal with to move them along the pathway."
            : partner.kind === "organisation"
              ? setter
                ? `${STEP_LABEL[place]}, set by ${setter.name} (${setter.status ? RELATIONSHIP_LABEL[setter.status] : "no status"}), the furthest along of ${live.length === 1 ? "the one person" : `the ${live.length} people`} here.`
                : `Not yet connected: nobody here has been contacted yet.`
              : `${STEP_LABEL[place]}: ${people[0]?.status ? RELATIONSHIP_LABEL[people[0].status] : "no status yet"}.`}
      </p>
      {canWrite && (nextChanges || prevChanges) ? (
        <div className="hq-path__moves">
          {prev && prevChanges ? (
            <PathwayMoveButton partner={partner} partnerName={name} to={prev} toLabel={STEP_LABEL[prev]} changes={prevChanges} direction="back" returnTo={returnTo} />
          ) : null}
          {next && nextChanges ? (
            <PathwayMoveButton partner={partner} partnerName={name} to={next} toLabel={STEP_LABEL[next]} changes={nextChanges} direction="forward" returnTo={returnTo} />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** How far along a live person is (0 = not yet connected). */
function rankOf(status: PartnerPathway["people"][number]["status"]): number {
  return PATHWAY_STEPS.indexOf(placeOf(status) as PathwayStep);
}
