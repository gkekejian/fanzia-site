"use client";

import MotionSection from "./MotionSection";

type Service = {
  n: string;
  title: string;
  body: string;
  tag?: string;
};

const SERVICES: Service[] = [
  {
    n: "01",
    title: "Custom AI Solutions",
    body:
      "AI-powered tools tailored to your business: automated client intake, intelligent CRM systems, sales copilots, custom integrations, and workflow automation. If it can be smarter, we'll make it smarter.",
  },
  {
    n: "02",
    title: "Lead Generation & Automation",
    body:
      "Automated lead capture, qualification, and routing. We build the funnels, integrate the ads, and connect everything to your CRM so leads flow in and nothing falls through the cracks.",
    tag: "Powered by CaseLynk",
  },
  {
    n: "03",
    title: "Web Design & Development",
    body:
      "AI-assisted websites built for speed, SEO, and conversions. Not templates. Custom-built platforms that work as hard as you do.",
  },
  {
    n: "04",
    title: "Social Media Advertising",
    body:
      "Targeted ad campaigns on Meta, Google, and YouTube designed to drive real leads, not vanity metrics. Full funnel strategy from impression to conversion.",
  },
];

export default function Services() {
  return (
    <MotionSection id="services" className="section bg-black text-white">
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-60" aria-hidden />
      <div className="container relative">
        <div className="grid items-end gap-10 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <p className="eyebrow">What We Build</p>
            <h2 className="h-section">
              Systems that <span className="text-brand-red">generate leads</span>,
              close work, and grow with you.
            </h2>
          </div>
          <p className="text-base text-white/70 lg:col-span-5 lg:text-lg">
            Four focused practice areas. Everything custom-built for local
            businesses. No templates, no recycled playbooks.
          </p>
        </div>

        <div className="mt-16 grid gap-0 border border-white/10 md:grid-cols-2">
          {SERVICES.map((s, i) => (
            <article
              key={s.n}
              className={`group relative overflow-hidden border-white/10 bg-brand-ink p-8 transition-colors hover:bg-brand-coal md:p-12 ${
                i % 2 === 0 ? "md:border-r" : ""
              } ${i < 2 ? "md:border-b" : ""} border-b md:last:border-b-0`}
            >
              <div className="flex items-start justify-between gap-4">
                <span className="font-display text-5xl text-white/20 transition group-hover:text-brand-red md:text-6xl">
                  {s.n}
                </span>
                {s.tag && (
                  <span className="inline-flex items-center gap-2 border border-brand-red px-3 py-1 font-display text-[10px] uppercase tracking-[0.2em] text-brand-red">
                    <span className="h-1 w-1 bg-brand-red" />
                    {s.tag}
                  </span>
                )}
              </div>

              <h3 className="mt-6 font-display text-3xl uppercase leading-tight tracking-tightest text-white md:text-4xl">
                {s.title}
              </h3>
              <p className="mt-4 text-base text-white/70 md:text-lg">{s.body}</p>

              <span
                aria-hidden
                className="absolute bottom-6 right-6 text-brand-red opacity-0 transition group-hover:opacity-100"
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="square" d="M5 12h14m0 0l-6-6m6 6l-6 6" />
                </svg>
              </span>
            </article>
          ))}
        </div>
      </div>
    </MotionSection>
  );
}
