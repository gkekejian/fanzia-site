"use client";

import MotionSection from "./MotionSection";

const CASES = [
  {
    client: "Technoland Computer Repair",
    location: "Glendale, CA",
    headline: "#1 on Google. Organically.",
    result:
      "Hundreds of 5-star reviews. Full website rebuild and digital transformation for a 35-year-old Glendale business.",
  },
  {
    client: "Bodies and Pilates",
    location: "Los Angeles, CA",
    headline: "$20K/mo in 6 months.",
    result:
      "Targeted social campaigns and automated class sign-up funnels turned a local studio into a full-book operation.",
  },
  {
    client: "SoCal Speech Therapy",
    location: "Southern California",
    headline: "Streamlined intake end-to-end.",
    result:
      "Community outreach campaigns for private school screenings. Streamlined office operations and patient communication.",
  },
];

export default function Results() {
  return (
    <MotionSection id="results" className="section bg-black text-white">
      <div className="container">
        <div className="max-w-3xl">
          <p className="eyebrow">Results</p>
          <h2 className="h-section">
            Real outcomes for <span className="text-brand-red">real</span> local businesses.
          </h2>
        </div>

        <div className="mt-16 grid gap-0 border border-white/10 md:grid-cols-3">
          {CASES.map((c, i) => (
            <article
              key={c.client}
              className={`group relative overflow-hidden bg-brand-ink p-8 transition-colors hover:bg-brand-coal md:p-10 ${
                i < CASES.length - 1
                  ? "border-b border-white/10 md:border-b-0 md:border-r"
                  : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-display text-xs uppercase tracking-[0.24em] text-brand-red">
                  {c.location}
                </span>
                <span
                  aria-hidden
                  className="h-3 w-3 rotate-45 bg-brand-red transition group-hover:scale-125"
                />
              </div>
              <h3 className="mt-6 font-display text-4xl leading-[0.95] tracking-tightest md:text-5xl">
                {c.headline}
              </h3>
              <p className="mt-5 text-white/70 md:text-lg">{c.result}</p>
              <div className="mt-6 border-t border-white/10 pt-4 font-display text-sm uppercase tracking-[0.18em] text-white/60">
                {c.client}
              </div>
            </article>
          ))}
        </div>
      </div>
    </MotionSection>
  );
}
