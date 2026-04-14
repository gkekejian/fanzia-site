"use client";

import MotionSection from "./MotionSection";
import WavePattern from "./WavePattern";

type Service = {
  n: string;
  title: string;
  body: string;
  tag?: string;
  accent?: boolean;
};

const SERVICES: Service[] = [
  {
    n: "01",
    title: "Custom AI Solutions",
    body:
      "AI-powered tools tailored to your business: automated client intake, intelligent CRM systems, sales copilots, custom integrations, and workflow automation. If it can be smarter, we'll make it smarter.",
    accent: true,
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
    accent: true,
  },
];

export default function Services() {
  return (
    <MotionSection id="services" className="relative bg-black text-white">
      <WavePattern
        className="pointer-events-none absolute -right-20 top-0 h-[500px] w-[700px]"
        stroke="#f13737"
        opacity={0.35}
      />

      <div className="container relative py-24 md:py-32">
        <div className="grid items-end gap-10 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <p className="eyebrow">What We Build</p>
            <h2 className="h-section">
              Systems that{" "}
              <span className="hl">generate leads</span>,
              <br />
              close work, and grow with you.
            </h2>
          </div>
          <p className="text-base text-white/70 lg:col-span-5 lg:text-lg">
            Four focused practice areas. Everything custom-built for local
            businesses. No templates, no recycled playbooks.
          </p>
        </div>

        <div className="mt-16 grid grid-cols-1 md:grid-cols-2">
          {SERVICES.map((s, i) => (
            <article
              key={s.n}
              className={`group relative overflow-hidden p-8 transition md:p-12 ${
                s.accent
                  ? "bg-brand-red text-white hover:bg-brand-rose"
                  : "bg-black text-white hover:bg-brand-coal"
              } ${i % 2 === 0 ? "md:border-r-4 md:border-black" : ""} ${
                i < 2 ? "border-b-4 border-black" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <span
                  className={`font-display text-6xl leading-none md:text-8xl ${
                    s.accent ? "text-black/40" : "text-white/20"
                  } transition group-hover:${s.accent ? "text-black" : "text-brand-red"}`}
                >
                  {s.n}
                </span>
                {s.tag && (
                  <span
                    className={`inline-flex items-center gap-2 border px-3 py-1 font-display text-[10px] uppercase tracking-[0.22em] ${
                      s.accent
                        ? "border-black bg-black text-brand-red"
                        : "border-brand-red bg-black text-brand-red"
                    }`}
                  >
                    <span className="h-1 w-1 bg-current" />
                    {s.tag}
                  </span>
                )}
              </div>

              <h3 className="mt-6 font-display text-3xl uppercase leading-[0.95] tracking-tightest md:text-4xl lg:text-5xl">
                {s.title}
              </h3>
              <p
                className={`mt-4 text-base md:text-lg ${
                  s.accent ? "text-white/90" : "text-white/70"
                }`}
              >
                {s.body}
              </p>

              <span
                aria-hidden
                className={`mt-8 inline-flex items-center gap-3 font-display text-xs uppercase tracking-[0.22em] ${
                  s.accent ? "text-black" : "text-brand-red"
                }`}
              >
                <span className="h-px w-10 bg-current" />
                See How
              </span>
            </article>
          ))}
        </div>
      </div>
    </MotionSection>
  );
}
