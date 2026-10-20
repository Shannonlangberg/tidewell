"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { STAGE_LABEL } from "@/lib/hq/constants";
import { formatAud, formatDate, plural } from "@/lib/hq/format";
import { LEAD_SOURCE_LABEL, dueText, isLeadSource } from "@/lib/hq/leads/rules";
import { COLLAPSED_STAGES, STAGE_ORDER, canLeaveSigned, columnTotals, daysInStageLabel, groupByStage, type Stage } from "@/lib/hq/referrals/stages";
import type { PipelineCard } from "@/lib/hq/referrals/types";
import { Avatar } from "../../Avatar";
import { Button } from "../../Button";
import { Icon } from "../../icons";
import { StatusChip } from "../../StatusChip";
import { WebsiteEnquiryChip } from "../enquiries/WebsiteEnquiryChip";
import { MoveStageDrawer, type MoveTarget } from "./MoveStageDrawer";
import styles from "./pipeline.module.css";

/*
 * The pipeline board: one column per stage, each prospect a card. There is no drag and drop: every
 * card has a "Move to..." button (a keyboard-accessible control) that opens the same move-stage
 * form the referral's page uses. Signed and lost are collapsed by default, with their counts.
 *
 * A lead appears ONCE: a referred lead under the partner who is credited, however many partners
 * claim it; a direct lead with its source. Each open card shows its owner, next action and
 * follow-up date (an overdue date is marked), and the name opens the lead's page. On a phone the board shows one column at a time (the stage selector above it
 * is link-based and sets `activeStage`).
 */

export type BoardCard = PipelineCard & { days: number | null };

function subscribe(onChange: () => void) {
  const query = window.matchMedia("(max-width: 767px)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True on a phone. The first render (server and hydration) assumes a wider screen. */
function usePhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia("(max-width: 767px)").matches,
    () => false,
  );
}

export function PipelineBoard({
  cards,
  activeStage,
  role,
  canMove,
  today,
  timezone,
  returnTo,
}: {
  cards: readonly BoardCard[];
  /** The column a phone shows. */
  activeStage: Stage;
  role: string;
  canMove: boolean;
  today: string;
  timezone: string;
  /** The pipeline address with its filters, so a move comes back to the same view. */
  returnTo: string;
}) {
  const phone = usePhone();
  const [expanded, setExpanded] = useState<ReadonlySet<Stage>>(new Set());
  const [moving, setMoving] = useState<BoardCard | null>(null);
  const [open, setOpen] = useState(false);

  const grouped = groupByStage(cards);
  const mayLeaveSigned = canLeaveSigned(role);

  const toggle = (stage: Stage) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });

  const target: MoveTarget | null = moving
    ? { opportunityId: moving.opportunityId, prospectName: moving.prospectName, stage: moving.stage, signedAt: moving.signedAt, managementReference: null }
    : null;

  return (
    <>
      <div className={styles.board} role="region" aria-label="Pipeline board (scrollable)" tabIndex={0}>
        {STAGE_ORDER.map((stage) => {
          const list = grouped[stage];
          const totals = columnTotals(list);
          const collapsible = COLLAPSED_STAGES.includes(stage);
          const isOpen = !collapsible || phone || expanded.has(stage);
          const headId = `pipeline-col-${stage}`;
          const heading = (
            <>
              <span className={styles.toggleLabel}>
                {STAGE_LABEL[stage]}
                {collapsible && !phone ? <Icon name="chevron-down" size={12} className={styles.chev} /> : null}
              </span>
              <span className={styles.count}>
                <span className="sr-only">, </span>
                {totals.count}
                <span className="sr-only"> {totals.count === 1 ? "prospect" : "prospects"}</span>
              </span>
            </>
          );
          return (
            <section key={stage} className={styles.col} data-stage={stage} data-active={stage === activeStage} data-collapsed={!isOpen} aria-labelledby={headId}>
              <h3 id={headId} className={styles.head}>
                {collapsible && !phone ? (
                  <button type="button" className={styles.toggle} aria-expanded={isOpen} aria-controls={`${headId}-lane`} onClick={() => toggle(stage)}>
                    {heading}
                  </button>
                ) : (
                  heading
                )}
              </h3>
              {totals.count > 0 ? (
                <p className={styles.total}>
                  {totals.withEstimate > 0 ? `${formatAud(totals.estimateCents)} estimate` : "No estimates yet"}
                  {totals.withEstimate > 0 && totals.withEstimate < totals.count ? `, ${totals.count - totals.withEstimate} without` : ""}
                </p>
              ) : null}
              <ul id={`${headId}-lane`} className={styles.lane} aria-label={`${STAGE_LABEL[stage]}, ${plural(totals.count, "prospect")}`}>
                {list.length === 0 ? (
                  <li className={styles.none}>None</li>
                ) : (
                  list.map((c) => {
                    const mayMove = canMove && (c.stage !== "management_signed" || mayLeaveSigned);
                    const signed = c.stage === "management_signed";
                    const open = c.stage !== "management_signed" && c.stage !== "lost";
                    const partner = c.partnerOrganisationName ?? c.partnerContactName;
                    const due = open && c.nextActionDue ? dueText(c.nextActionDue, today) : null;
                    const overdue = open && !!c.nextActionDue && c.nextActionDue < today;
                    return (
                      <li key={c.opportunityId} className={styles.card} data-signed={signed}>
                        <div>
                          <span className={styles.name}>
                            <Link href={`/hq/growth/opportunities/${c.opportunityId}`}>{c.prospectName}</Link>
                          </span>
                          {c.propertySuburb ? <span className={styles.sub}>{c.propertySuburb}</span> : null}
                        </div>
                        <div className={styles.src}>
                          {partner ? (
                            <>
                              {signed ? "Credited to " : "Via "}
                              {partner}
                              {c.partnerOrganisationName && c.partnerContactName ? `, ${c.partnerContactName}` : ""}
                            </>
                          ) : c.source === "website_enquiry" ? (
                            <WebsiteEnquiryChip />
                          ) : (
                            (isLeadSource(c.source) ? LEAD_SOURCE_LABEL[c.source] : "Direct lead")
                          )}
                        </div>
                        {open ? (
                          <div className={styles.next} data-overdue={overdue}>
                            {c.nextAction ? <span className={styles.nextAction}>{c.nextAction}</span> : <span>No next step</span>}
                            {c.nextActionDue ? (
                              <span className={styles.due}>
                                {overdue ? <span className="sr-only">Overdue: </span> : null}
                                {due ?? formatDate(c.nextActionDue, timezone)}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                        <div className={styles.meta}>
                          {c.assignedToName ? (
                            <span className={styles.who}>
                              <Avatar name={c.assignedToName} size="sm" label={`Owner: ${c.assignedToName}`} />
                            </span>
                          ) : (
                            <span className={styles.noOwner}>No owner</span>
                          )}
                          {c.estimateCents !== null ? <span className={styles.estimate}>{formatAud(c.estimateCents)} est.</span> : null}
                          <span>{signed && c.signedAt ? `Signed ${formatDate(c.signedAt, timezone)}` : c.days === null ? "" : c.days <= 0 ? "In stage today" : `${daysInStageLabel(c.days)} in stage`}</span>
                        </div>
                        {c.otherClaims > 0 ? (
                          <div>
                            <StatusChip plain title="Other partners also introduced this prospect. Only the credited source counts if they sign.">
                              {plural(c.otherClaims, "other claim")}
                            </StatusChip>
                          </div>
                        ) : null}
                        {mayMove ? (
                          <div className={styles.actions}>
                            <Button
                              size="sm"
                              onClick={() => {
                                setMoving(c);
                                setOpen(true);
                              }}
                              aria-label={`Move ${c.prospectName} to another stage`}
                            >
                              Move to&hellip;
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    );
                  })
                )}
              </ul>
            </section>
          );
        })}
      </div>

      {canMove ? <MoveStageDrawer open={open} onClose={() => setOpen(false)} target={target} role={role} today={today} timezone={timezone} returnTo={returnTo} /> : null}
    </>
  );
}
