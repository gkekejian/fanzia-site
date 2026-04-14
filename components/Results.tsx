"use client";

import MotionSection from "./MotionSection";

const CASES = [
  {
    client: "Technoland Computer Repair",
    location: "Glendale, CA",
    result:
      "Ranked #1 on Google organically. Hundreds of 5-star reviews. Full website rebuild and digital transformation for a 35-year-old Glendale business.",
  },
  {
    client: "Bodies and Pilates",
    location: "Los Angeles, CA",
    result:
      "$20K/month revenue within 6 months through targeted social campaigns and automated class sign-up funnels.",
  },
  {
    client: "SoCal Speech Therapy",
    location: "Southern California",
    result:
      "Community outreach campaigns for private school screenings. Streamlined office operations and patient communication.",
  },
];

export default function Results() {
  return (
    <MotionSection id="results" className="section bg-white">
      <div className="container">
        <div className="max-w-2xl">
          <p className="eyebrow">Results</p>
          <h2 className="h-section">Real outcomes for real local businesses.</h2>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {CASES.map((c) => (
            <article
              key={c.client}
              className="card h-full border-t-4 border-t-brand-accent"
            >
              <div className="text-sm font-semibold uppercase tracking-wide text-brand-accent">
                {c.location}
              </div>
              <h3 className="mt-2 text-xl font-bold text-brand-primary">
                {c.client}
              </h3>
              <p className="mt-3 text-brand-text/80">{c.result}</p>
            </article>
          ))}
        </div>
      </div>
    </MotionSection>
  );
}
