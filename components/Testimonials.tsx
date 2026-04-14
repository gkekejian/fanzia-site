"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import MotionSection from "./MotionSection";
import WavePattern from "./WavePattern";

const QUOTES = [
  {
    quote:
      "Fanzia rebuilt our online presence from the ground up. We now rank at the top of Google in Glendale and our phone hasn't stopped ringing. They treat our business like their own.",
    initial: "G",
    role: "Owner, 35-Year Computer Repair Business",
  },
  {
    quote:
      "Within six months we hit $20K a month. The campaigns they built brought in the right clients, and the automated sign-ups meant I could focus on teaching instead of chasing emails.",
    initial: "P",
    role: "Owner, Boutique Pilates Studio",
  },
  {
    quote:
      "They understood what a specialty practice actually needs. Their outreach and office systems changed how we run the clinic day to day.",
    initial: "S",
    role: "Owner, Specialty Therapy Clinic",
  },
];

export default function Testimonials() {
  const [i, setI] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % QUOTES.length), 7000);
    return () => clearInterval(id);
  }, []);

  return (
    <MotionSection className="relative overflow-hidden bg-brand-red text-black noise">
      <WavePattern
        className="pointer-events-none absolute inset-0 h-full w-full"
        stroke="#000"
        opacity={0.15}
        lines={26}
      />
      <div className="container relative py-24 md:py-32">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-2 bg-black px-3 py-1.5 font-display text-[11px] uppercase tracking-[0.3em] text-brand-red">
            <span className="h-1.5 w-1.5 bg-brand-red" />
            What Clients Say
          </span>
          <span className="h-px flex-1 bg-black/30" />
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-4">
            <div className="font-display text-[10rem] leading-none text-black md:text-[14rem]">
              &ldquo;
            </div>
            <h2 className="display text-4xl text-black md:text-5xl lg:text-6xl">
              Trusted by
              <br />
              operators.
            </h2>
          </div>

          <div className="relative min-h-[320px] border-l-4 border-black pl-6 md:pl-10 lg:col-span-8">
            <AnimatePresence mode="wait">
              <motion.figure
                key={i}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.45, ease: "easeOut" }}
              >
                <blockquote className="font-display text-2xl uppercase leading-[1.05] tracking-tightest text-black md:text-4xl lg:text-5xl">
                  {QUOTES[i].quote}
                </blockquote>
                <figcaption className="mt-8 flex items-center gap-4">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black font-display text-xl text-brand-red">
                    {QUOTES[i].initial}
                  </span>
                  <span>
                    <span className="block font-display text-sm uppercase tracking-[0.2em] text-black">
                      {QUOTES[i].role}
                    </span>
                    <span className="text-sm text-black/70">
                      Name withheld on client request
                    </span>
                  </span>
                </figcaption>
              </motion.figure>
            </AnimatePresence>

            <div className="mt-10 flex gap-2">
              {QUOTES.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  aria-label={`Show testimonial ${idx + 1}`}
                  onClick={() => setI(idx)}
                  className={`h-1.5 transition-all ${
                    idx === i ? "w-12 bg-black" : "w-3 bg-black/30"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </MotionSection>
  );
}
