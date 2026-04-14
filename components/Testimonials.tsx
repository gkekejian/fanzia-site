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
    <MotionSection className="section bg-brand-secondary text-white">
      <div className="container">
        <div className="max-w-2xl">
          <p className="eyebrow !text-brand-accent">What clients say</p>
          <h2 className="mt-3 text-3xl font-bold md:text-4xl lg:text-5xl">
            Built by operators, trusted by operators.
          </h2>
        </div>

        <div className="relative mt-12 min-h-[220px]">
          <AnimatePresence mode="wait">
            <motion.figure
              key={i}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.45, ease: "easeOut" }}
              className="max-w-3xl"
            >
              <blockquote className="text-xl leading-relaxed text-white/90 md:text-2xl">
                &ldquo;{QUOTES[i].quote}&rdquo;
              </blockquote>
              <figcaption className="mt-6 text-sm">
                <span className="font-semibold text-white">
                  {QUOTES[i].name}
                </span>
                <span className="text-white/60">, {QUOTES[i].role}</span>
              </figcaption>
            </motion.figure>
          </AnimatePresence>

          <div className="mt-8 flex gap-2">
            {QUOTES.map((_, idx) => (
              <button
                key={idx}
                type="button"
                aria-label={`Show testimonial ${idx + 1}`}
                onClick={() => setI(idx)}
                className={`h-2 rounded-full transition-all ${
                  idx === i ? "w-8 bg-brand-accent" : "w-2 bg-white/30"
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </MotionSection>
  );
}
