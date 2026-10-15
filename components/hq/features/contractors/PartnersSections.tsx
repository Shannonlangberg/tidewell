import { HQ_ROUTES } from "../../nav";
import { Tabs } from "../../Tabs";

/** The two views of the Partners (contractors) module: the directory, and one container per trade. */
export function PartnersSections({ current, className }: { current: "directory" | "trades"; className?: string }) {
  return (
    <Tabs
      label="Partners sections"
      className={className ?? "mb-8"}
      items={[
        { label: "Directory", href: HQ_ROUTES.partners, current: current === "directory" },
        { label: "Trades", href: HQ_ROUTES.partnerTrades, current: current === "trades" },
      ]}
    />
  );
}
