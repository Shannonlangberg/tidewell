import { Mark } from "@/components/Mark";
import { EnquiryForm } from "@/components/EnquiryForm";
import { SITE, telHref } from "@/lib/site";

const PROMISES = [
  ["published prices", "Eighteen per cent of accommodation revenue plus GST, and a one-off setup price. On this website, not in a proposal. No lock-in after your first Easter."],
  ["a live dashboard", "Look in on your phone at ten at night and see your bookings and your money. Not a PDF at the end of the month."],
  ["a photo of every room", "After every clean, so you see what the next guest will see."],
  ["a reply inside the hour", "Eight in the morning to ten at night. A person, not a queue. We'd rather you check."],
] as const;

const TAKE_OFF = [
  ["guests", "Enquiries, bookings and questions after check-in, 8am to 10pm."],
  ["cleaners", "Every clean scheduled and checked, with photos of each room afterwards."],
  ["pricing", "Nightly rates adjusted through the year, including school holidays, Easter and festival weeks."],
  ["repairs", "We arrange the tradesperson and tell you before spending more than you've agreed."],
] as const;

const STEPS = [
  ["we talk", "Tell us about your house, what you have now and what you'd like off your plate. It's your call."],
  ["we set it up", "Listing, photos, pricing and cleaners, all arranged and agreed with you."],
  ["we look after it", "Guests, cleans, rates and repairs are ours from here. You check the dashboard when you feel like it."],
] as const;

const FAQ = [
  ["Do you hold my money?", "No. Bookings and payouts stay in your own accounts. We never hold your money."],
  ["Can I keep my existing listing?", "Yes. Bookings and payouts stay in your own accounts, so we can work with the listing you have. Tell us where it's listed and we'll talk it through. If it needs a fresh start, setup covers a new listing."],
  ["What if I want to leave?", "There's no lock-in after your first Easter. Your bookings and payouts are already in your own accounts, so leaving means we step back."],
  ["How quickly do you reply?", "Inside the hour, 8am to 10pm. That goes for guests and for you."],
  ["What does setup only include?", "We style, photograph, write and price the listing, then hand it back to you to run. It's a one-off cost of $3,000 to $5,000."],
  ["Do I need to be there?", "No. That's the point of living two hours away. We handle guests, cleans and repairs, and we tell you before spending more than you've agreed."],
] as const;

const STATS = [
  ["Inside the hour", "Every message, owner or guest"],
  ["8am to 10pm", "When a person answers"],
] as const;

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  name: SITE.name,
  slogan: SITE.tagline,
  description:
    "Holiday home management on the Copper Coast, South Australia, for owners who live about two hours away in Adelaide.",
  areaServed: SITE.towns.map((t) => ({ "@type": "Place", name: `${t}, South Australia` })),
  founder: [
    { "@type": "Person", name: "Shannon" },
    { "@type": "Person", name: "Court" },
  ],
  ...(SITE.url ? { url: SITE.url } : {}),
  ...(SITE.phone ? { telephone: SITE.phone } : {}),
  ...(SITE.email ? { email: SITE.email } : {}),
  ...(SITE.legalName ? { legalName: SITE.legalName } : {}),
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, "\\u003c") }}
      />
      <a href="#main" className="skip">Skip to content</a>

      {/* ░ HEADER ░ */}
      <header className="header">
        <div className="header-inner">
          <a href="#top" className="brand" aria-label="Tidewell, back to top">
            <Mark width={23} fill="var(--copper)" hole="var(--verdigris)" />
            <span className="wordmark" style={{ fontSize: 27 }}>tidewell</span>
          </a>
          <nav className="nav" aria-label="Main">
            <a href="#services">What we do</a>
            <a href="#pricing">Pricing</a>
            <a href="#where">Where we work</a>
            <a href="#faq">Questions</a>
          </nav>
          <div className="header-cta">
            <a href="#talk" className="btn btn-copper btn-sm">Ask about your home</a>
          </div>
        </div>
      </header>

      <main id="main">
        <div id="top" />
        {/* ░ HERO ░ */}
        <section style={{ background: "var(--verdigris)", color: "var(--bone)" }}>
          <div
            className="grid hero-grid"
            style={{ maxWidth: "var(--max)", margin: "0 auto", padding: "clamp(40px,6vw,88px) var(--gutter) clamp(48px,7vw,104px)" }}
          >
            <div>
              <p className="label" style={{ color: "var(--sea-mist)" }}>Holiday home management · Copper Coast, South Australia</p>
              <h1 className="display" style={{ marginTop: "clamp(20px,3vw,32px)", fontSize: "clamp(40px,6.2vw,80px)", lineHeight: 0.98 }}>
                holiday homes,<br /><span style={{ color: "var(--copper)" }}>kept well.</span>
              </h1>
              <p style={{ marginTop: "clamp(22px,3vw,30px)", maxWidth: 540, fontSize: "clamp(18px,1.5vw,19px)", color: "var(--body-on-dark)" }}>
                We look after holiday homes on the Copper Coast for owners who live two hours away. Guests, cleaners, pricing, repairs and the 10pm phone call all come to us.
              </p>
              <div style={{ display: "flex", gap: 12, marginTop: "clamp(26px,3vw,36px)", flexWrap: "wrap" }}>
                <a href="#talk" className="btn btn-copper">Ask about your home</a>
                <a href="#pricing" className="btn btn-ghost-dark">See what it costs</a>
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
            <p className="label">What you can count on</p>
            <div className="grid promises" style={{ marginTop: "clamp(26px,3vw,40px)" }}>
              {PROMISES.map(([title, text]) => (
                <div key={title}>
                  <div style={{ height: 5, width: 44, background: "var(--copper)" }} />
                  <h2 className="display" style={{ marginTop: 18, fontSize: "clamp(26px,2.6vw,33px)", lineHeight: 1.05, letterSpacing: "-.04em", color: "var(--verdigris)" }}>{title}</h2>
                  <p className="body" style={{ marginTop: 12, lineHeight: 1.6 }}>{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ░ WHAT WE TAKE OFF YOUR HANDS ░ */}
        <section id="services" className="rule-b anchor">
          <div className="wrap">
            <h2 className="display h2">what we take off<br />your hands</h2>
            <div className="grid cells seasons" style={{ marginTop: "clamp(28px,3vw,44px)" }}>
              {TAKE_OFF.map(([name, text]) => (
                <div key={name} style={{ background: "var(--bone-light)", padding: "clamp(22px,2.4vw,30px)" }}>
                  <h3 className="display" style={{ fontSize: "clamp(24px,2.3vw,30px)", lineHeight: 1.05, letterSpacing: "-.04em", color: "var(--verdigris)" }}>{name}</h3>
                  <p className="body" style={{ marginTop: 10, lineHeight: 1.6 }}>{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ░ PRICING ░ */}
        <section id="pricing" className="rule-b anchor">
          <div className="wrap">
            <div className="head-row">
              <h2 className="display h2">what it costs</h2>
              <a href="#talk" className="link-rule">Ask about your home</a>
            </div>
            <div className="grid services" style={{ marginTop: "clamp(28px,3vw,44px)" }}>
              <article className="card card-flood">
                <p className="label label-sm" style={{ color: "var(--copper-bright)" }}>Ongoing</p>
                <h3 className="display card-title">looked after</h3>
                <p style={{ lineHeight: 1.6, color: "var(--body-on-dark)" }}>Your holiday home, let by the night. Guests, cleaners, pricing, repairs and the ten o&rsquo;clock phone call.</p>
                <div className="card-foot">
                  <div className="price">18% + GST</div>
                  <p className="small" style={{ color: "var(--muted-on-dark)" }}>of accommodation revenue. Bookings and payouts stay in your accounts. We never hold your money.</p>
                </div>
              </article>
              <article className="card card-light">
                <p className="label label-sm">One-off</p>
                <h3 className="display card-title">setup only</h3>
                <p className="body" style={{ lineHeight: 1.6 }}>We style, photograph, write and price the listing, then hand it back to you to run.</p>
                <div className="card-foot">
                  <div className="price">$3,000 to $5,000</div>
                  <p className="small">Once.</p>
                </div>
              </article>
            </div>
            <div className="grid trust body" style={{ marginTop: "clamp(24px,3vw,36px)", paddingTop: 24, borderTop: "1px solid var(--hairline)" }}>
              <p>Cleaning, linen and repairs are charged separately and itemised.</p>
              <p>No lock-in after your first Easter.</p>
            </div>
          </div>
        </section>

        {/* ░ HOW IT STARTS ░ */}
        <section id="start" className="anchor" style={{ background: "var(--bone-light)", borderBottom: "1px solid var(--hairline)" }}>
          <div className="wrap grid two-col">
            <div>
              <h2 className="display h2">how it starts</h2>
              <p className="body" style={{ marginTop: 20, maxWidth: 480 }}>Just got the keys, or years in and tired of the 10pm calls? Start with a conversation. You don&rsquo;t need to have decided anything yet.</p>
              <a href="#talk" className="btn btn-copper" style={{ marginTop: 28 }}>Ask about your home</a>
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

        {/* ░ ALWAYS ON ░ */}
        <section style={{ background: "var(--dune)" }}>
          <div className="wrap grid two-col">
            <div>
              <p className="label" style={{ color: "var(--dune-label)" }}>8am to 10pm</p>
              <h2 className="display h2" style={{ marginTop: 16 }}>we answer inside<br />the hour. we&rsquo;d<br />rather you check.</h2>
              <p className="body" style={{ marginTop: 20, maxWidth: 520 }}>Every message, from an owner or a guest, gets a reply from a person inside the hour, between 8am and 10pm. We publish the times and we hold ourselves to them.</p>
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

        {/* ░ WHERE WE WORK ░ */}
        <section id="where" className="anchor" style={{ background: "var(--verdigris)", color: "var(--bone)" }}>
          <div className="wrap grid two-col" style={{ gap: "clamp(28px,4vw,56px)" }}>
            <div>
              <h2 className="display h2" style={{ color: "var(--bone)" }}>high tide in january.<br /><span style={{ color: "var(--copper)" }}>we&rsquo;re here in july too.</span></h2>
              <p style={{ marginTop: 20, maxWidth: 500, color: "var(--body-on-dark)" }}>We work with family holiday houses, often three bedrooms and a few streets back from the beach. If your place is somewhere else nearby, ask.</p>
              <p style={{ marginTop: 14, maxWidth: 500, color: "var(--body-on-dark)" }}>Shannon and Court live on the Copper Coast.</p>
            </div>
            <div>
              <p className="label label-sm" style={{ color: "var(--sea-mist)", marginBottom: 14 }}>Where we work</p>
              <ul className="grid cells towns" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {SITE.towns.map((t) => (
                  <li key={t} style={{ background: "var(--verdigris)", padding: "22px 20px", fontWeight: 600, fontSize: 19 }}>{t}</li>
                ))}
                <li style={{ gridColumn: "1 / -1", background: "var(--verdigris)" }}>
                  <a href="#talk" style={{ display: "block", padding: "22px 20px", fontWeight: 600, fontSize: 19, color: "var(--copper-bright)" }}>Somewhere else? Ask us</a>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* ░ FAQ ░ */}
        <section id="faq" className="rule-b anchor">
          <div className="wrap">
            <h2 className="display h2">questions owners ask</h2>
            <div className="faq" style={{ marginTop: "clamp(24px,3vw,40px)" }}>
              {FAQ.map(([q, a]) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <p className="body">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ░ ENQUIRY ░ */}
        <section id="talk" className="anchor">
          <div className="wrap grid two-col" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))" }}>
            <div>
              <h2 className="display h2">ask about<br />your home</h2>
              <p className="body" style={{ marginTop: 20, maxWidth: 460 }}>Tell us a little about your house and what you&rsquo;re thinking. A person will reply inside the hour, 8am to 10pm. No obligation.</p>
              {(SITE.phone || SITE.email) && (
                <div style={{ marginTop: 28, paddingTop: 24, borderTop: "1px solid var(--hairline)", display: "flex", flexDirection: "column", gap: 12 }}>
                  <p className="label label-sm">Or just get in touch</p>
                  {SITE.phone && (
                    <a href={telHref(SITE.phone)} style={{ fontWeight: 600, fontSize: "clamp(26px,2.8vw,34px)", letterSpacing: "-.02em", lineHeight: 1.2, color: "var(--verdigris)" }}>{SITE.phone}</a>
                  )}
                  <p className="small">
                    8am to 10pm.{SITE.email && <> <a href={`mailto:${SITE.email}`}>{SITE.email}</a></>}
                  </p>
                </div>
              )}
            </div>
            <EnquiryForm />
          </div>
        </section>

        {/* ░ ABOUT STRIP ░ */}
        <section id="about" className="anchor" style={{ background: "var(--dune)" }}>
          <div style={{ maxWidth: "var(--max)", margin: "0 auto", padding: "clamp(32px,4vw,56px) var(--gutter)" }}>
            <h2 className="display" style={{ fontSize: "clamp(26px,2.8vw,36px)", lineHeight: 1.05, letterSpacing: "-.045em", color: "var(--verdigris)" }}>we live here</h2>
            <p className="body" style={{ marginTop: 12, maxWidth: 620 }}>Tidewell is two people on the Copper Coast: Shannon and Court.</p>
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
              <p style={{ marginTop: 12, fontWeight: 500, color: "var(--muted-on-dark)" }}>{SITE.tagline}</p>
              <p style={{ marginTop: 4, color: "var(--body-on-dark)" }}>{SITE.region}</p>
            </div>
            <FootCol title="Where we work" items={[...SITE.towns, "And across the Copper Coast"]} />
            <FootCol title="Pages" links={[["What we do", "#services"], ["Pricing", "#pricing"], ["Questions", "#faq"], ["Ask about your home", "#talk"], ["Privacy", "/privacy"]]} />
            {(SITE.phone || SITE.email) && (
              <FootCol
                title="Get us"
                items={[SITE.phone, SITE.email, "8am to 10pm"].filter((x): x is string => Boolean(x))}
              />
            )}
          </div>
          {/* ABN and licence details go here before launch. Set legalName and abn in lib/site.ts. */}
          <p style={{ marginTop: "clamp(28px,3vw,44px)", paddingTop: 22, borderTop: "1px solid var(--deep-line)", font: "400 13px/1.8 var(--font-mono), monospace", maxWidth: 900 }}>
            {[SITE.legalName, SITE.abn].filter(Boolean).join(" · ")}
            {(SITE.legalName || SITE.abn) && <br />}
            &copy; {new Date().getFullYear()} {SITE.name}
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
