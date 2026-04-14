"use client";

import { motion } from "framer-motion";

export default function Hero() {
  return (
    <section
      id="top"
      className="relative overflow-hidden bg-brand-primary pt-32 pb-24 text-white md:pt-40 md:pb-32"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(60% 50% at 20% 10%, rgba(233,69,96,0.25) 0%, rgba(233,69,96,0) 60%), radial-gradient(45% 40% at 85% 30%, rgba(22,33,62,0.9) 0%, rgba(26,26,46,0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <div className="container relative">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="max-w-3xl"
        >
          <span className="inline-block rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/80">
            Glendale &amp; Los Angeles, CA
          </span>
          <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight md:text-5xl lg:text-6xl">
            We Build AI-Powered Systems That Grow Your Business.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-white/80 md:text-xl">
            Custom AI tools, automated lead generation, intelligent websites,
            and CRM systems built for small businesses in Los Angeles.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <a href="#contact" className="btn-primary">
              Get a Free Consultation
            </a>
            <a href="#services" className="btn-outline">
              See What We Build
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
