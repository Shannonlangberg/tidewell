"use client";

import { Button } from "./Button";
import { Drawer } from "./Drawer";
import { Icon } from "./icons";

/*
 * Ask Planted: the right-hand drawer. It is HONEST by design.
 *
 * The assistant arrives in Phase 3 (docs/hq-design.md, section 8). Until then this panel
 * explains what it will do, says plainly that it is not connected yet, and says it will
 * only ever answer from real records. There is NO chat box and NO canned answers: the
 * example questions are static text, not buttons, so nothing here pretends to work.
 *
 * The one working thing offered is the search that already exists.
 */

const EXAMPLES = [
  "Who are our preferred plumbers in Wallaroo?",
  "Who should Shannon follow up with this week?",
  "How many managements have we gained through brokers?",
] as const;

export function AskPlantedPanel({ open, onClose, onOpenSearch }: { open: boolean; onClose: () => void; onOpenSearch: () => void }) {
  return (
    <Drawer open={open} onClose={onClose} title="Ask Planted" description="Not connected yet. Arrives in Phase 3." className="hq-ask">
      <div className="hq-ask__body">
        <p className="hq-ask__lead">
          <Icon name="sparkle" size={20} className="hq-ask__sparkle" />
          <span>Ask Planted will be an assistant for HQ: you ask a question in plain English and it looks through your own records for the answer.</span>
        </p>

        <section aria-labelledby="hq-ask-examples" className="hq-ask__section">
          <h3 id="hq-ask-examples" className="hq-label">
            Examples of what you will be able to ask
          </h3>
          <ul className="hq-ask__examples">
            {EXAMPLES.map((q) => (
              <li key={q}>&ldquo;{q}&rdquo;</li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="hq-ask-honest" className="hq-ask__section">
          <h3 id="hq-ask-honest" className="hq-label">
            What to expect
          </h3>
          <ul className="hq-ask__points">
            <li>It is not connected yet, so there is nothing to ask today. Nothing on this panel is a live answer.</li>
            <li>
              When it arrives it will only answer from real records in HQ. If the records do not hold the answer, it will say so instead of guessing.
            </li>
            <li>It will start by reading and looking things up, not by changing anything.</li>
          </ul>
        </section>

        <div className="hq-ask__actions">
          <p className="hq-ask__aside">In the meantime, search already finds contacts, organisations, referrals and tasks.</p>
          <Button
            variant="secondary"
            icon="search"
            onClick={() => {
              onClose();
              onOpenSearch();
            }}
          >
            Search HQ
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
