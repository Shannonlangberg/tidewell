import { dayFrom, nextNights, short, type Stay } from "@/lib/demo";

export function Nights({ stays }: { stays: Stay[] }) {
  const nights = nextNights(stays);
  const booked = nights.filter((n) => n.state === "booked").length;
  const own = nights.some((n) => n.state === "own");
  return (
    <div>
      <div className="o-row-head">
        <span className="o-label">The next 14 nights</span>
        <span style={{ fontWeight: 500, fontSize: 15, color: booked ? "var(--o-copper-text)" : "var(--o-muted)" }}>{booked} booked</span>
      </div>
      <div className="o-bars" role="img" aria-label={`${booked} of the next 14 nights booked`}>
        {nights.map((n) => <div key={n.offset} className={`o-bar ${n.state}`} />)}
      </div>
      <div className="o-axis">
        <span>Tonight</span>
        <span>{short(dayFrom(7))}</span>
        <span>{short(dayFrom(13))}</span>
      </div>
      {own && <p className="o-small" style={{ marginTop: 8 }}>Outlined nights are yours.</p>}
    </div>
  );
}
