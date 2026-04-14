"use client";

import Image from "next/image";
import { motion } from "framer-motion";

export default function Hero() {
  return (
    <section
      id="top"
      className="relative overflow-hidden bg-black pt-36 pb-24 text-white md:pt-44 md:pb-32 noise"
    >
      {/* Signature topographic wave pattern (SVG) */}
      <svg
        aria-hidden
        className="pointer-events-none absolute -right-24 top-10 h-[680px] w-[680px] opacity-40"
        viewBox="0 0 600 600"
      >
        <defs>
          <radialGradient id="g1" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#f13737" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#f13737" stopOpacity="0" />
          </radialGradient>
        </defs>
        {Array.from({ length: 24 }).map((_, i) => (
          <circle
            key={i}
            cx="300"
            cy="300"
            r={40 + i * 12}
            fill="none"
            stroke="url(#g1)"
            strokeWidth="1"
            opacity={1 - i / 26}
          />
        ))}
      </svg>

      <div className="pointer-events-none absolute inset-0 grid-bg" aria-hidden />

      <div className="container relative">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
        >
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 animate-pulse rounded-full bg-brand-red" />
            <span className="font-display text-xs uppercase tracking-[0.3em] text-white/60">
              Glendale / Los Angeles, CA
            </span>
          </div>

          <h1 className="mt-8 display text-6xl text-white md:text-7xl lg:text-[8rem] xl:text-[9.5rem]">
            AI-Powered
            <br />
            Growth for
            <br />
            <span className="text-brand-red">Local Business.</span>
          </h1>

          <div className="mt-10 grid gap-10 lg:grid-cols-12 lg:items-end">
            <p className="max-w-2xl text-lg text-white/70 md:text-xl lg:col-span-7">
              Custom AI tools, automated lead generation, intelligent websites,
              and CRM systems built for small businesses in Los Angeles. We
              build the infrastructure that makes your business operate
              smarter.
            </p>
            <div className="flex flex-wrap items-center gap-4 lg:col-span-5 lg:justify-end">
              <a href="#contact" className="btn-primary">
                Get a Free Consultation
              </a>
              <a href="#services" className="btn-ghost">
                See the Work
              </a>
            </div>
          </div>
        </motion.div>

        {/* Logo mark watermark, bottom left */}
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-16 -left-12 opacity-[0.07] md:-bottom-24 md:-left-20"
        >
          <Image
            src="/brand/logo-white.png"
            alt=""
            width={520}
            height={140}
            className="w-[320px] md:w-[520px]"
          />
        </div>
      </div>

      {/* Marquee of capability tags */}
      <div className="relative mt-20 overflow-hidden border-y border-white/10 bg-black py-4">
        <div className="flex animate-marquee gap-12 whitespace-nowrap font-display text-lg uppercase tracking-[0.2em] text-white/60 md:text-xl">
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
              <span key={i} className="flex items-center gap-12">
                {t}
                <span className="text-brand-red">/</span>
              </span>
            ))}
        </div>
      </div>
    </section>
  );
}
