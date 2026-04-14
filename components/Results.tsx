"use client";

import MotionSection from "./MotionSection";
import WavePattern from "./WavePattern";

const CASES = [
  {
    stat: "#1",
    statLabel: "On Google. Organic.",
    client: "35-Year Computer Repair Business",
    location: "Glendale, CA",
    result:
      "Hundreds of 5-star reviews. Full website rebuild and digital transformation for a multi-decade Glendale business.",
  },
  {
    stat: "$20K",
    statLabel: "Monthly revenue / 6 mo",
    client: "Boutique Pilates Studio",
    location: "Los Angeles, CA",
    result:
      "Targeted social campaigns and automated class sign-up funnels turned a local studio into a full-book operation.",
  },
  {
    stat: "7+",
    statLabel: "Private school screenings",
    client: "Specialty Therapy Clinic",
    location: "Southern California",
    result:
      "Community outreach campaigns for private school screenings. Streamlined office operations and patient communication.",
  },
];

export default function Results() {
  return (
    <MotionSection id="results" className="relative bg-black text-white">
      <WavePattern
        className="pointer-events-none absolute -left-20 top-20 h-[500px] w-[700px]"
        stroke="#f13737"
        opacity={0.3}
      />
      <div className="container relative py-24 md:py-32">
        <div className="grid items-end gap-10 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <p className="eyebrow">Receipts</p>
            <h2 className="h-section">
              Real outcomes.
              <br />
              <span className="hl">Real businesses.</span>
            </h2>
          </div>
          <p className="text-base text-white/70 lg:col-span-5 lg:text-lg">
            Numbers off the board. These aren&rsquo;t pilot projects, they are
            live engagements driving revenue today. Client names withheld on
            request.
          </p>
        </div>

        <div className="mt-16 grid gap-0">
          {CASES.map((c, i) => (
            <article
              key={c.client}
              className={`group relative grid grid-cols-1 gap-0 border-white/10 bg-black transition hover:bg-brand-ink md:grid-cols-12 md:items-stretch ${
                i === 0 ? "border-t-4 border-brand-red" : "border-t border-white/10"
              } ${i === CASES.length - 1 ? "border-b-4 border-brand-red" : ""}`}
            >
              {/* Huge stat */}
              <div className="relative flex items-center overflow-hidden bg-brand-red p-8 md:col-span-4 md:p-12">
                <div
                  aria-hidden
                  className="absolute inset-0"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(45deg, rgba(0,0,0,0.08) 0 2px, transparent 2px 18px)",
                  }}
                />
                <div className="relative">
                  <span className="block font-display text-7xl leading-[0.9] text-white md:text-[8rem] lg:text-[9.5rem]">
                    {c.stat}
                  </span>
                  <span className="mt-2 block font-display text-xs uppercase tracking-[0.22em] text-black">
                    {c.statLabel}
                  </span>
                </div>
              </div>

              {/* Body */}
              <div className="flex flex-col justify-center p-8 md:col-span-8 md:p-12">
                <div className="flex items-center gap-3">
                  <span className="font-display text-xs uppercase tracking-[0.24em] text-brand-red">
                    {c.location}
                  </span>
                  <span className="h-px w-10 bg-brand-red" />
                </div>
                <h3 className="mt-3 font-display text-3xl uppercase leading-[0.95] tracking-tightest text-white md:text-4xl lg:text-5xl">
                  {c.client}
                </h3>
                <p className="mt-4 max-w-2xl text-white/75 md:text-lg">
                  {c.result}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </MotionSection>
  );
}
