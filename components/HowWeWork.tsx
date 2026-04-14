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
    <MotionSection id="how-we-work" className="section bg-brand-light">
      <div className="container">
        <div className="max-w-2xl">
          <p className="eyebrow">How we work</p>
          <h2 className="h-section">A process built around your business, not ours.</h2>
        </div>

        <ol className="mt-14 grid gap-6 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.n} className="relative">
              <div className="card h-full">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-brand-accent">
                    {s.n}
                  </span>
                  <span className="h-px flex-1 bg-brand-accent/30" />
                </div>
                <h3 className="mt-4 text-xl font-bold text-brand-primary">
                  {s.title}
                </h3>
                <p className="mt-3 text-brand-text/80">{s.body}</p>
              </div>
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden
                  className="absolute -right-3 top-1/2 hidden -translate-y-1/2 text-brand-accent md:block"
                >
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 12h14m0 0l-6-6m6 6l-6 6"
                    />
                  </svg>
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </MotionSection>
  );
}
