"use client";

import MotionSection from "./MotionSection";

const STEPS = [
  {
    n: "01",
    title: "Discovery",
    body:
      "We learn your business, your bottlenecks, and where AI and automation can make the biggest impact.",
  },
  {
    n: "02",
    title: "Build",
    body:
      "We design and develop custom tools, sites, campaigns, and integrations. No off-the-shelf templates.",
  },
  {
    n: "03",
    title: "Launch & Optimize",
    body:
      "We deploy, monitor, and iterate. Your systems get smarter over time.",
  },
];

export default function HowWeWork() {
  return (
    <MotionSection id="how-we-work" className="section bg-brand-cream text-black">
      <div className="container">
        <div className="max-w-3xl">
          <p className="eyebrow">The Process</p>
          <h2 className="h-section-light">
            A process built around <span className="text-brand-red">your business</span>,
            not ours.
          </h2>
        </div>

        <ol className="mt-16 grid gap-0 border border-black md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li
              key={s.n}
              className={`relative bg-white p-8 md:p-10 ${
                i < STEPS.length - 1 ? "border-b border-black md:border-b-0 md:border-r" : ""
              }`}
            >
              <div className="flex items-baseline gap-4">
                <span className="font-display text-7xl leading-none text-brand-red md:text-8xl">
                  {s.n}
                </span>
                <span className="h-px flex-1 bg-black" />
              </div>
              <h3 className="mt-8 font-display text-3xl uppercase tracking-tightest md:text-4xl">
                {s.title}
              </h3>
              <p className="mt-3 text-base text-black/70 md:text-lg">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </MotionSection>
  );
}
