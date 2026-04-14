"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import WavePattern from "./WavePattern";

export default function Hero() {
  return (
    <section
      id="top"
      className="relative overflow-hidden bg-black pt-24 text-white"
    >
      {/* Top red status bar */}
      <div className="relative z-10 border-b border-white/10 bg-brand-red">
        <div className="container flex h-9 items-center justify-between font-display text-[11px] uppercase tracking-[0.28em] text-white">
          <div className="flex items-center gap-3">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-white" />
            <span>Live // Glendale &amp; Los Angeles</span>
          </div>
          <div className="hidden md:block">Built by Operators / For Operators</div>
          <div>Est. 2021</div>
        </div>
      </div>

      <div className="container relative grid gap-0 lg:grid-cols-12 lg:items-stretch">
        {/* LEFT: Copy + CTAs on black */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="relative z-10 py-16 md:py-24 lg:col-span-7 lg:py-28 lg:pr-10"
        >
          <span className="inline-flex items-center gap-3 border border-brand-red bg-black px-3 py-1.5 font-display text-[11px] uppercase tracking-[0.3em] text-brand-red">
            <span className="h-1.5 w-1.5 bg-brand-red" />
            AI-Powered Growth Agency
          </span>

          <h1 className="mt-8 display text-[3.6rem] leading-[0.95] text-white sm:text-7xl md:text-[7rem] lg:text-[7.5rem] xl:text-[9rem]">
            <span className="block">The Agency</span>
            <span className="block">Run By</span>
            <span className="block text-brand-red">Operators.</span>
          </h1>

          <p className="mt-8 max-w-xl text-lg text-white/75 md:text-xl">
            Fanzia builds custom AI, automated lead generation, intelligent
            websites, and CRM systems for local businesses. We run our own
            operations too, so we build the kind of infrastructure we&rsquo;d
            actually want to use.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <a href="#contact" className="btn-primary">
              Get a Free Consultation
            </a>
            <a href="#services" className="btn-ghost">
              See the Work
            </a>
          </div>

          {/* Stat strip */}
          <dl className="mt-14 grid max-w-2xl grid-cols-3 gap-0 border-t border-white/10">
            {[
              { v: "100%", k: "Custom-built" },
              { v: "5+", k: "Years operating" },
              { v: "LA", k: "Local & loud" },
            ].map((s, i) => (
              <div
                key={s.k}
                className={`py-5 ${i < 2 ? "border-r border-white/10 pr-5" : "pr-5"} ${i > 0 ? "pl-5" : ""}`}
              >
                <dt className="font-display text-4xl leading-none text-brand-red md:text-5xl">
                  {s.v}
                </dt>
                <dd className="mt-2 font-display text-[10px] uppercase tracking-[0.22em] text-white/50">
                  {s.k}
                </dd>
              </div>
            ))}
          </dl>
        </motion.div>

        {/* RIGHT: Big red panel with logo mark + wave pattern */}
        <motion.div
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.1 }}
          className="relative flex min-h-[420px] items-center justify-center overflow-hidden bg-brand-red lg:col-span-5 lg:min-h-[780px]"
        >
          <WavePattern
            className="absolute inset-0 h-full w-full"
            stroke="#000"
            opacity={0.25}
            lines={26}
          />
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              backgroundImage:
                "repeating-linear-gradient(45deg, rgba(0,0,0,0.08) 0 2px, transparent 2px 16px)",
            }}
          />

          {/* Diagonal corner ribbons */}
          <div className="absolute -left-10 top-10 rotate-[-4deg] bg-black px-8 py-2 font-display text-xs uppercase tracking-[0.3em] text-brand-red shadow-[6px_6px_0_0_rgba(0,0,0,0.4)]">
            Glendale, CA
          </div>
          <div className="absolute -right-8 bottom-16 rotate-[4deg] bg-black px-8 py-2 font-display text-xs uppercase tracking-[0.3em] text-white shadow-[6px_6px_0_0_rgba(0,0,0,0.4)]">
            Est. 2021
          </div>

          <div className="relative z-10 flex flex-col items-center px-6 py-16 text-center">
            <Image
              src="/brand/logo-white.png"
              alt="Fanzia"
              width={600}
              height={160}
              priority
              className="w-[260px] drop-shadow-[0_0_40px_rgba(0,0,0,0.35)] md:w-[360px] lg:w-[420px]"
            />
            <p className="mt-10 max-w-xs font-display text-sm uppercase leading-relaxed tracking-[0.22em] text-black">
              Built by Operators.
              <br />
              For Operators.
            </p>
          </div>
        </motion.div>
      </div>

      {/* Marquee of capability tags, red on black */}
      <div className="relative border-y-4 border-brand-red bg-black py-5">
        <div className="flex animate-marquee gap-10 whitespace-nowrap font-display text-xl uppercase tracking-[0.22em] text-white md:text-2xl">
          {[
            "Custom AI Systems",
            "Lead Automation",
            "Intelligent Websites",
            "CRM Builds",
            "Social Ad Campaigns",
            "Integrations",
          ]
            .concat([
              "Custom AI Systems",
              "Lead Automation",
              "Intelligent Websites",
              "CRM Builds",
              "Social Ad Campaigns",
              "Integrations",
            ])
            .map((t, i) => (
              <span key={i} className="flex items-center gap-10">
                {t}
                <span className="text-brand-red">/</span>
              </span>
            ))}
        </div>
      </div>
    </section>
  );
}
