"use client";

import { Header } from "@/components/app/Header";
import { DOCUMENTS } from "@/lib/demo";

export default function Documents() {
  return (
    <>
      <Header />
      <main className="o-main">
        <div>
          <h1 className="o-title">your papers</h1>
          <p className="o-status">Everything about your tenancy, in one place. Nothing here expires on you without a heads-up first.</p>
        </div>
        <div className="o-list">
          {DOCUMENTS.map((d) => (
            <div key={d.title} style={{ padding: "15px 0", display: "flex", gap: 12, alignItems: "center" }}>
              <span aria-hidden style={{ width: 28, height: 36, border: "1.5px solid var(--o-tab-off)", borderRadius: "14px 14px 2px 2px", flex: "none" }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 600, fontSize: 17 }}>{d.title}</span>
                <span className="o-small">{d.meta}</span>
              </span>
              <span className="o-small">PDF</span>
            </div>
          ))}
        </div>
        <p className="o-small">In the demo these aren&rsquo;t real files.</p>
      </main>
    </>
  );
}
