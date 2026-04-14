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
    <MotionSection id="how-we-work" className="relative bg-brand-cream text-black">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, #000 0 1px, transparent 1px 14px)",
        }}
      />
      <div className="container relative py-24 md:py-32">
        <div className="grid items-end gap-10 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <p className="eyebrow">The Process</p>
            <h2 className="h-section-light">
              A process built around
              <br />
              <span className="bg-brand-red px-3 text-white">your business</span>,
              not ours.
            </h2>
          </div>
          <p className="text-base text-black/70 lg:col-span-5 lg:text-lg">
            Three phases. Tightly scoped, no mystery meetings, no fluff.
          </p>
        </div>

        <ol className="mt-16 grid grid-cols-1 border-[3px] border-black md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li
              key={s.n}
              className={`relative flex flex-col bg-white p-8 md:p-10 ${
                i < STEPS.length - 1
                  ? "border-b-[3px] border-black md:border-b-0 md:border-r-[3px]"
                  : ""
              }`}
            >
              <div className="flex items-baseline gap-4">
                <span className="font-display text-[6rem] leading-none text-brand-red md:text-[7rem]">
                  {s.n}
                </span>
                <span className="h-px flex-1 bg-black" />
              </div>
              <h3 className="mt-8 font-display text-3xl uppercase tracking-tightest md:text-4xl">
                {s.title}
              </h3>
              <p className="mt-3 text-base text-black/75 md:text-lg">{s.body}</p>
              <span className="mt-auto pt-10 font-display text-[10px] uppercase tracking-[0.22em] text-black/40">
                Phase {s.n}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </MotionSection>
  );
}
