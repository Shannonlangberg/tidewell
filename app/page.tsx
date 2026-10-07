import { Mark } from "@/components/Mark";
import { EnquiryForm } from "@/components/EnquiryForm";

const PROMISES = [
  ["published prices", "Eighteen per cent plus GST for short-stay, eight for long-term. On the website, not in a proposal. And no lock-in after the first Easter."],
  ["a live dashboard", "Open your phone at ten at night and see tonight, the next fourteen nights, and this month's money to the dollar. Not a PDF at the end of the month."],
  ["a photo of every room", "After every single clean. The job can't be marked done until every room is photographed, so you see what the next guest sees."],
  ["a reply inside the hour", "Eight in the morning to ten at night, every day. A person, not a queue. We'd rather you check."],
] as const;

// Southern-hemisphere seasons. Draft list — confirm it's what Tidewell will actually do before launch.
const SEASONS = [
  { name: "autumn", months: "Mar – May", items: ["Gutters and downpipes cleared before the winter rain", "Roof and flashings checked", "Heating tested before anyone needs it"] },
  { name: "winter", months: "Jun – Aug", items: ["Walk-through after every big storm", "Damp, drains and seals checked", "Quiet months used for the jobs that take a week"] },
  { name: "spring", months: "Sep – Nov", items: ["Salt rinsed off outdoor fittings and fixtures", "Garden, yard and fire-season clean-up", "Deep clean and fresh photos before the summer rush"] },
  { name: "summer", months: "Dec – Feb", items: ["Air-con serviced before the first hot week", "Extra checks between back-to-back guests", "Anything that wears fast, fixed between bookings"] },
];

const AHEAD = [
  ["we tell you before it costs you", "If we can see something coming, like a hot-water service on its last legs or a deck that needs oiling, you hear about it early, with a price, while it's still small."],
  ["anything over $150 waits for your yes", "Small fixes we just do. Bigger ones come to you first, with photos and a quote. We never spend your money without you knowing."],
  ["you see all of it", "Every check and every fix, with photos, in the app. If we've been there, you can see what we saw."],
] as const;

const STEPS = [
  ["we walk through it", "With you or without you. We photograph every room, test what works and write down what needs doing, before a guest or tenant finds it."],
  ["we tell you what it could do", "Holiday let, long-term tenants, or looked after until you're ready. Plain numbers and no pressure. It's your call."],
  ["we get it ready", "Styling, photos, listing and trades, or just a clear list if you'd rather do it yourself. Either way, you're not starting from scratch."],
] as const;

const STATS = [
  ["Inside the hour", "Every message, owner or guest"],
  ["8am – 10pm", "Covered, every day of the week"],
  ["365 days", "A year, Christmas included"],
  ["Same day", "On site when a place needs someone"],
] as const;

// Placeholder addresses and rates — photos are real. Flagged on the page.
const HOMES = [
  { photo: "12-bayview-road", focus: "62%", address: "12 Bayview Road", meta: "Moonta Bay · sleeps 6 · short-stay", rate: "From $185 a night", copper: true },
  { photo: "port-hughes", focus: "58%", address: "4 Simms Cove Road", meta: "Port Hughes · sleeps 8 · short-stay", rate: "From $240 a night", copper: true },
  { photo: "wallaroo", focus: "55%", address: "27 Heritage Drive", meta: "Wallaroo · sleeps 4 · long-term", rate: "Tenanted to March 2027", copper: false },
  { photo: "north-beach", focus: "52%", address: "9 Esplanade", meta: "North Beach · sleeps 6 · short-stay", rate: "From $210 a night", copper: true },
];

const TOWNS = ["Moonta Bay", "Port Hughes", "Wallaroo", "North Beach"];

export default function Home() {
  return (
    <>
      {/* ░ HEADER ░ */}
      <header className="header">
        <div className="header-inner">
          <a href="#top" className="brand" aria-label="Tidewell home">
            <Mark width={23} fill="var(--copper)" hole="var(--verdigris)" />
            <span className="wordmark" style={{ fontSize: 27 }}>tidewell</span>
          </a>
          <nav className="nav" aria-label="Main">
            <a href="#services">What we do</a>
            <a href="#pricing">Pricing</a>
            <a href="#homes">Our homes</a>
            <a href="#about">About</a>
          </nav>
          <div className="header-cta">
            <a href="/app" className="btn btn-ghost-dark btn-sm">Log in</a>
            <a href="#talk" className="btn btn-copper btn-sm">Talk to us</a>
          </div>
        </div>
      </header>

      <main id="top">
        {/* ░ HERO ░ */}
        <section style={{ background: "var(--verdigris)", color: "var(--bone)" }}>
          <div
            className="grid hero-grid"
            style={{ maxWidth: "var(--max)", margin: "0 auto", padding: "clamp(40px,6vw,88px) var(--gutter) clamp(48px,7vw,104px)" }}
          >
            <div>
              <p className="label" style={{ color: "var(--sea-mist)" }}>Property management · Copper Coast, South Australia</p>
              <h1 className="display" style={{ marginTop: "clamp(20px,3vw,32px)", fontSize: "clamp(40px,6.2vw,80px)", lineHeight: 0.98 }}>
                you care about<br />your place.<br /><span style={{ color: "var(--copper)" }}>so do we.</span>
              </h1>
              <p style={{ marginTop: "clamp(22px,3vw,30px)", maxWidth: 540, fontSize: "clamp(17px,1.5vw,19px)", color: "var(--body-on-dark)" }}>
                You bought it, you love it, and you can&rsquo;t be here every week. We can. We look after it like it&rsquo;s ours — the guests, the tenants, the cleaners, the repairs — and we fix things before they break.
              </p>
              <p style={{ marginTop: 14, maxWidth: 540, fontSize: "clamp(17px,1.5vw,19px)", color: "var(--body-on-dark)" }}>
                A person answers inside the hour, eight in the morning to ten at night, every day of the year.
              </p>
              <div style={{ display: "flex", gap: 12, marginTop: "clamp(26px,3vw,36px)", flexWrap: "wrap" }}>
                <a href="#pricing" className="btn btn-copper">See published prices</a>
                <a href="#talk" className="btn btn-ghost-dark">Talk to us</a>
              </div>
            </div>
            <div
              className="tag-crop"
              role="img"
              aria-label="A white weatherboard house with the lights on at sunset"
              style={{ backgroundColor: "#255049", backgroundImage: "url(/photos/12-bayview-road.jpg)", backgroundPosition: "center 62%" }}
            />
          </div>
        </section>

        {/* ░ FOUR PROMISES ░ */}
        <section className="rule-b">
          <div className="wrap">
            <p className="label">What you get, every week, in writing</p>
            <div className="grid promises" style={{ marginTop: "clamp(26px,3vw,40px)" }}>
              {PROMISES.map(([title, text]) => (
                <div key={title}>
                  <div style={{ height: 5, width: 44, background: "var(--copper)" }} />
                  <h3 className="display" style={{ marginTop: 18, fontSize: "clamp(26px,2.6vw,33px)", lineHeight: 1.05, letterSpacing: "-.04em", color: "var(--verdigris)" }}>{title}</h3>
                  <p className="body" style={{ marginTop: 12, lineHeight: 1.6 }}>{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ░ BEFORE IT BREAKS ░ */}
        <section id="ahead" className="rule-b anchor">
          <div className="wrap">
            <div className="grid two-col">
              <div>
                <p className="label">Before it breaks</p>
                <h2 className="display h2" style={{ marginTop: 16 }}>we don&rsquo;t wait<br />for things to break</h2>
              </div>
              <div style={{ alignSelf: "end" }}>
                <p className="body" style={{ maxWidth: 560 }}>A place left to itself goes downhill slowly. Salt on the fittings, leaves in the gutters, a drip nobody hears. We get there first. Every place we look after has a plan for the year, and you can see it.</p>
              </div>
            </div>
            <div className="grid cells seasons" style={{ marginTop: "clamp(28px,3vw,44px)" }}>
              {SEASONS.map((season) => (
                <div key={season.name} style={{ background: "var(--bone-light)", padding: "clamp(22px,2.4vw,30px)" }}>
                  <p className="label label-sm">{season.months}</p>
                  <h3 className="display" style={{ marginTop: 10, fontSize: "clamp(24px,2.3vw,30px)", lineHeight: 1.05, letterSpacing: "-.04em", color: "var(--verdigris)" }}>{season.name}</h3>
                  <ul className="ticks">
                    {season.items.map((i) => <li key={i}>{i}</li>)}
                  </ul>
                </div>
              ))}
            </div>
            <div className="grid trust" style={{ marginTop: "clamp(28px,3vw,40px)" }}>
              {AHEAD.map(([title, text]) => (
                <div key={title}>
                  <div style={{ height: 5, width: 44, background: "var(--copper)" }} />
                  <h3 style={{ marginTop: 14, fontWeight: 600, fontSize: 19, color: "var(--verdigris)" }}>{title}</h3>
                  <p className="body" style={{ marginTop: 6, lineHeight: 1.6 }}>{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ░ JUST BOUGHT ░ */}
        <section id="just-bought" className="anchor" style={{ background: "var(--bone-light)", borderBottom: "1px solid var(--hairline)" }}>
          <div className="wrap grid two-col">
            <div>
              <p className="label">Just bought?</p>
              <h2 className="display h2" style={{ marginTop: 16 }}>just got<br />the keys?</h2>
              <p className="body" style={{ marginTop: 20, maxWidth: 480 }}>Settlement&rsquo;s done, the place is yours, and the list is already as long as your arm. Start with us. You don&rsquo;t need to have decided anything yet.</p>
              <a href="#talk" className="btn btn-copper" style={{ marginTop: 28 }}>Tell us about your new place</a>
            </div>
            <ol className="steps">
              {STEPS.map(([title, text], i) => (
                <li key={title}>
                  <span className="step-num">0{i + 1}</span>
                  <div>
                    <h3 className="display" style={{ fontSize: "clamp(24px,2.3vw,30px)", lineHeight: 1.05, letterSpacing: "-.04em", color: "var(--verdigris)" }}>{title}</h3>
                    <p className="body" style={{ marginTop: 8, lineHeight: 1.6 }}>{text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ░ SERVICES / PRICING ░ */}
        <section id="services" className="rule-b anchor">
          <div id="pricing" className="wrap anchor">
            <div className="head-row">
              <h2 className="display h2">what we do,<br />and what it costs</h2>
              <a href="#talk" className="link-rule">Ask what your place would earn</a>
            </div>
            <div className="grid services" style={{ marginTop: "clamp(28px,3vw,44px)" }}>
              <article className="card card-flood">
                <p className="label label-sm" style={{ color: "var(--copper-bright)" }}>Most owners start here</p>
                <h3 className="display card-title">short-stay</h3>
                <p style={{ lineHeight: 1.6, color: "var(--body-on-dark)" }}>Your holiday home, let by the night. Guests, cleaners, pricing, repairs, the ten o&rsquo;clock phone call. Listed on Airbnb, Stayz, Booking.com and direct.</p>
                <div className="card-foot">
                  <div className="price">18% + GST</div>
                  <p className="small" style={{ color: "var(--muted-on-dark)" }}>of accommodation revenue. Bookings and payouts stay in your accounts — we never hold your money.</p>
                </div>
              </article>
              <article className="card card-light">
                <p className="label label-sm" style={{ color: "var(--copper-deep)" }}>Licence application lodged</p>
                <h3 className="display card-title">long-term</h3>
                <p className="body" style={{ lineHeight: 1.6 }}>A house let to people who live in it. Tenant selection, inspections with photographs, rent, repairs and the paperwork that goes with them.</p>
                <div className="card-foot">
                  <div className="price">8% + GST</div>
                  <p className="small">of rent collected. Available once our agent&rsquo;s licence is granted — you can go on the list now.</p>
                </div>
              </article>
              <article className="card card-light">
                <p className="label label-sm">For places nobody is in</p>
                <h3 className="display card-title">property care</h3>
                <p className="body" style={{ lineHeight: 1.6 }}>We walk through, check it over, photograph it and send you the lot. Storms, leaks, mail, the lawn, the tap you meant to look at in April.</p>
                <div className="card-foot">
                  <span className="flag">Price to confirm</span>
                  <p className="small" style={{ marginTop: 10 }}>This one goes on the site the day we set it. We don&rsquo;t do &ldquo;contact us for a quote&rdquo;.</p>
                </div>
              </article>
              <article className="card card-light">
                <p className="label label-sm">One-off, then we leave</p>
                <h3 className="display card-title">setup only</h3>
                <p className="body" style={{ lineHeight: 1.6 }}>We style it, photograph it, write the listing and price the first twelve months, then hand you the keys to your own account. You run it from there.</p>
                <div className="card-foot">
                  <div className="price">$3,000 – $5,000</div>
                  <p className="small">Once. Depending on the size of the house and whether it needs styling.</p>
                </div>
              </article>
            </div>
            <div className="grid trust body" style={{ marginTop: "clamp(24px,3vw,36px)", paddingTop: 24, borderTop: "1px solid var(--hairline)" }}>
              <p>No lock-in after your first Easter. If it isn&rsquo;t working, you take it back and we&rsquo;ll hand over everything we&rsquo;ve built.</p>
              <p>We don&rsquo;t take a cut of anything except our own fee. No booking mark-ups, no commission on trades, no charge for the app.</p>
              <p>Want to know what your place would earn? Send us the address and we&rsquo;ll work it out and send it back — <a href="#talk" className="link-rule" style={{ fontWeight: 400, paddingBottom: 1 }}>inside the hour</a>.</p>
            </div>
          </div>
        </section>

        {/* ░ ALWAYS ON ░ */}
        <section style={{ background: "var(--dune)" }}>
          <div className="wrap grid two-col">
            <div>
              <p className="label" style={{ color: "var(--dune-label)" }}>Eight in the morning to ten at night</p>
              <h2 className="display h2" style={{ marginTop: 16 }}>we answer inside<br />the hour. we&rsquo;d<br />rather you check.</h2>
              <p className="body" style={{ marginTop: 20, maxWidth: 520 }}>Every message, from an owner or a guest, gets a reply from a person within sixty minutes. Overnight, an emergency number rings a mobile that is answered. We publish the times and we hold ourselves to them.</p>
              <p style={{ marginTop: 16 }}><a href="#about" className="link-rule">Who you&rsquo;ll be talking to</a></p>
            </div>
            <div className="grid cells stats">
              {STATS.map(([big, small]) => (
                <div key={big} style={{ background: "var(--bone)", padding: "24px 22px" }}>
                  <div style={{ fontWeight: 600, fontSize: "clamp(28px,3vw,36px)", letterSpacing: "-.03em", lineHeight: 1.2, color: "var(--verdigris)" }}>{big}</div>
                  <p className="small" style={{ marginTop: 6 }}>{small}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ░ OUR HOMES ░ */}
        <section id="homes" className="rule-b anchor">
          <div className="wrap">
            <div className="head-row">
              <div>
                <p className="label">The proof is the portfolio</p>
                <h2 className="display h2" style={{ marginTop: 16 }}>the places<br />we keep</h2>
              </div>
              <a href="#allhomes" className="link-rule">See them all</a>
            </div>
            <div className="flag" style={{ marginTop: 22 }}>Photos are real · addresses and rates are placeholder</div>
            <div className="grid homes" style={{ marginTop: 20 }}>
              {HOMES.map((h) => (
                <a key={h.address} href="#allhomes" style={{ color: "inherit", display: "block" }}>
                  <div
                    className="tag-crop"
                    style={{ borderRadius: "999px 999px 8px 8px", backgroundColor: "#DDD5BF", backgroundImage: `url(/photos/${h.photo}.jpg)`, backgroundPosition: `center ${h.focus}` }}
                  />
                  <div style={{ marginTop: 14, fontWeight: 600, fontSize: 19, color: "var(--ink)" }}>{h.address}</div>
                  <div style={{ fontSize: 15, color: "var(--driftwood)" }}>{h.meta}</div>
                  <div style={{ marginTop: 8, fontWeight: 500, fontSize: 15, color: h.copper ? "var(--copper-deep)" : "var(--driftwood)" }}>{h.rate}</div>
                </a>
              ))}
            </div>
          </div>
        </section>

        {/* ░ TOWNS ░ */}
        <section style={{ background: "var(--verdigris)", color: "var(--bone)" }}>
          <div className="wrap grid two-col" style={{ gap: "clamp(28px,4vw,56px)" }}>
            <div>
              <h2 className="display h2" style={{ color: "var(--bone)" }}>high tide in january.<br /><span style={{ color: "var(--copper)" }}>we&rsquo;re here in july too.</span></h2>
              <p style={{ marginTop: 20, maxWidth: 500, color: "var(--body-on-dark)" }}>We look after places across the Copper Coast, and we&rsquo;re on the ground year round — not just over summer. If your place is somewhere we haven&rsquo;t been yet, ask.</p>
            </div>
            <div>
              <p className="label label-sm" style={{ color: "var(--sea-mist)", marginBottom: 14 }}>Where our places are today</p>
              <div className="grid cells towns">
                {TOWNS.map((t) => (
                  <div key={t} style={{ background: "var(--verdigris)", padding: "22px 20px", fontWeight: 600, fontSize: 19 }}>{t}</div>
                ))}
                <a href="#talk" style={{ gridColumn: "1 / -1", background: "var(--verdigris)", padding: "22px 20px", fontWeight: 600, fontSize: 19, color: "var(--copper-bright)" }}>Somewhere else? Ask us</a>
              </div>
            </div>
          </div>
        </section>

        {/* ░ ENQUIRY ░ */}
        <section id="talk" className="anchor">
          <div className="wrap grid two-col" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))" }}>
            <div>
              <h2 className="display h2">tell us about<br />your place</h2>
              <p className="body" style={{ marginTop: 20, maxWidth: 460 }}>Send the address and what you&rsquo;re thinking. We&rsquo;ll come back inside the hour with what we&rsquo;d charge and what we&rsquo;d expect it to earn — no meeting required, no obligation.</p>
              <div style={{ marginTop: 28, paddingTop: 24, borderTop: "1px solid var(--hairline)", display: "flex", flexDirection: "column", gap: 12 }}>
                <p className="label label-sm">Or just ring</p>
                <a href="tel:+61417604882" style={{ fontWeight: 600, fontSize: "clamp(26px,2.8vw,34px)", letterSpacing: "-.02em", lineHeight: 1.2, color: "var(--verdigris)" }}>0417 604 882</a>
                <p className="small">8am – 10pm, every day. <a href="mailto:hello@tidewell.com.au">hello@tidewell.com.au</a></p>
              </div>
            </div>
            <EnquiryForm />
          </div>
        </section>

        {/* ░ ABOUT STRIP ░ */}
        <section id="about" className="anchor" style={{ background: "var(--dune)" }}>
          <div style={{ maxWidth: "var(--max)", margin: "0 auto", padding: "clamp(32px,4vw,56px) var(--gutter)", display: "flex", gap: "clamp(20px,3vw,40px)", alignItems: "center", flexWrap: "wrap" }}>
            {/* Placeholder until real photography — do not ship */}
            <div
              aria-hidden
              style={{ width: 110, height: 154, borderRadius: "55px 55px 6px 6px", background: "repeating-linear-gradient(135deg,#C4B695 0 9px,#CEC0A0 9px 18px)", display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 14, flex: "none", font: "400 10px var(--font-mono), monospace", color: "#4E4A3C" }}
            >
              one photo
            </div>
            <div style={{ flex: 1, minWidth: 250 }}>
              <h2 className="display" style={{ fontSize: "clamp(26px,2.8vw,36px)", lineHeight: 1.05, letterSpacing: "-.045em", color: "var(--verdigris)" }}>we live here</h2>
              <p className="body" style={{ marginTop: 12, maxWidth: 620 }}>Tidewell is two people on the Copper Coast. We take on what we can get to, and we say no to the rest.</p>
              <a href="#aboutpage" className="link-rule" style={{ display: "inline-block", marginTop: 14 }}>About us</a>
            </div>
          </div>
        </section>
      </main>

      {/* ░ FOOTER ░ */}
      <footer style={{ background: "var(--deep)", color: "var(--sea-mist)" }}>
        <div style={{ maxWidth: "var(--max)", margin: "0 auto", padding: "clamp(36px,4vw,60px) var(--gutter)" }}>
          <div className="grid foot" style={{ fontSize: 15 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Mark width={21} fill="var(--copper-bright)" hole="var(--deep)" />
                <span className="wordmark" style={{ fontSize: 26, color: "var(--bone)" }}>tidewell</span>
              </div>
              <p style={{ marginTop: 12, fontWeight: 500, color: "var(--muted-on-dark)" }}>Your place, kept well</p>
            </div>
            <FootCol title="Where we work" items={[...TOWNS, "And across the Copper Coast"]} />
            <FootCol title="Pages" links={[["What we do", "#services"], ["Pricing", "#pricing"], ["Our homes", "#homes"], ["Log in", "/app"]]} />
            <FootCol title="Get us" items={["0417 604 882", "hello@tidewell.com.au", "8am – 10pm, every day"]} />
          </div>
          <p style={{ marginTop: "clamp(28px,3vw,44px)", paddingTop: 22, borderTop: "1px solid var(--deep-line)", font: "400 12.5px/1.8 var(--font-mono), monospace", maxWidth: 900 }}>
            Tidewell Property Co Pty Ltd · ABN 47 682 119 004 · Moonta Bay SA 5558<br />
            Short-stay accommodation is let in accordance with Copper Coast Council short-term rental accommodation registration. Our application for a South Australian property agent&rsquo;s licence is lodged with Consumer and Business Services; long-term management begins once it is granted.
          </p>
        </div>
      </footer>
    </>
  );
}

function FootCol({ title, items, links }: { title: string; items?: string[]; links?: [string, string][] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p className="label label-sm" style={{ color: "var(--sea-mist)", marginBottom: 4 }}>{title}</p>
      {items?.map((i) => <span key={i} style={{ color: "var(--body-on-dark)" }}>{i}</span>)}
      {links?.map(([label, href]) => <a key={href} href={href} style={{ color: "var(--body-on-dark)" }}>{label}</a>)}
    </div>
  );
}
