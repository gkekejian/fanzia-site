"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import MotionSection from "./MotionSection";

const QUOTES = [
  {
    quote:
      "Fanzia rebuilt our online presence from the ground up. We now rank at the top of Google in Glendale and our phone hasn't stopped ringing. They treat our business like their own.",
    name: "Steve",
    role: "Owner, Technoland Computer Repair",
  },
  {
    quote:
      "Within six months we hit $20K a month. The campaigns they built brought in the right clients, and the automated sign-ups meant I could focus on teaching instead of chasing emails.",
    name: "Naira",
    role: "Owner, Bodies and Pilates",
  },
  {
    quote:
      "They understood what a specialty practice actually needs. Their outreach and office systems changed how we run the clinic day to day.",
    name: "Owner",
    role: "SoCal Speech Therapy",
  },
];

export default function Testimonials() {
  const [i, setI] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % QUOTES.length), 7000);
    return () => clearInterval(id);
  }, []);

  return (
    <MotionSection className="section bg-black text-white">
      <div className="container">
        <div className="max-w-3xl">
          <p className="eyebrow">Receipts</p>
          <h2 className="h-section">
            Built by operators. <span className="text-brand-red">Trusted</span> by operators.
          </h2>
        </div>

        <div className="relative mt-16 min-h-[260px] border-l-4 border-brand-red pl-6 md:pl-10">
          <AnimatePresence mode="wait">
            <motion.figure
              key={i}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.45, ease: "easeOut" }}
              className="max-w-4xl"
            >
              <blockquote className="font-display text-2xl uppercase leading-tight tracking-tightest text-white md:text-4xl lg:text-5xl">
                &ldquo;{QUOTES[i].quote}&rdquo;
              </blockquote>
              <figcaption className="mt-8 flex items-center gap-4">
                <span className="h-10 w-10 rounded-full bg-brand-red" />
                <span>
                  <span className="block font-display text-sm uppercase tracking-[0.2em] text-white">
                    {QUOTES[i].name}
                  </span>
                  <span className="text-sm text-white/60">
                    {QUOTES[i].role}
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
                  idx === i ? "w-12 bg-brand-red" : "w-3 bg-white/20"
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </MotionSection>
  );
}
