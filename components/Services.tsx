"use client";

import MotionSection from "./MotionSection";

type Service = {
  title: string;
  body: string;
  tag?: string;
};

const SERVICES: Service[] = [
  {
    title: "Custom AI Solutions",
    body:
      "We build AI-powered tools tailored to your business: automated client intake, intelligent CRM systems, sales copilots, custom integrations, and workflow automation. If it can be smarter, we'll make it smarter.",
  },
  {
    title: "Lead Generation & Automation",
    body:
      "Automated lead capture, qualification, and routing. We build the funnels, integrate the ads, and connect everything to your CRM so leads flow in and nothing falls through the cracks.",
    tag: "Powered by CaseLynk",
  },
  {
    title: "Web Design & Development",
    body:
      "AI-assisted websites built for speed, SEO, and conversions. Not templates. Custom-built platforms that work as hard as you do.",
  },
  {
    title: "Social Media Advertising",
    body:
      "Targeted ad campaigns on Meta, Google, and YouTube designed to drive real leads, not vanity metrics. Full funnel strategy from impression to conversion.",
  },
];

export default function Services() {
  return (
    <MotionSection id="services" className="section bg-white">
      <div className="container">
        <div className="max-w-2xl">
          <p className="eyebrow">What we do</p>
          <h2 className="h-section">
            Systems that generate leads, close work, and grow with you.
          </h2>
          <p className="mt-5 text-lg text-brand-text/80">
            Four focused practice areas. Everything custom-built for local
            businesses.
          </p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICES.map((s) => (
            <article key={s.title} className="card flex flex-col">
              {s.tag && (
                <span className="mb-3 inline-flex w-fit rounded-full bg-brand-accent/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-brand-accent">
                  {s.tag}
                </span>
              )}
              <h3 className="text-xl font-bold text-brand-primary">
                {s.title}
              </h3>
              <p className="mt-3 text-brand-text/80">{s.body}</p>
            </article>
          ))}
        </div>
      </div>
    </MotionSection>
  );
}
