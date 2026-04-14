"use client";

import Image from "next/image";
import MotionSection from "./MotionSection";
import WavePattern from "./WavePattern";

const FACTS = [
  { k: "Based in", v: "Glendale, CA" },
  { k: "Serving", v: "Los Angeles area" },
  { k: "Specialty", v: "AI & Automation" },
  { k: "HQ", v: "Los Angeles, CA" },
];

export default function About() {
  return (
    <MotionSection id="about" className="relative bg-black text-white">
      <div className="container py-24 md:py-32">
        <div className="grid gap-12 lg:grid-cols-12 lg:items-stretch lg:gap-16">
          <div className="lg:col-span-7">
            <p className="eyebrow">About Fanzia</p>
            <h2 className="h-section">
              A Glendale team building
              <br />
              <span className="hl">growth infrastructure</span>
              <br />
              for local business.
            </h2>
            <p className="mt-8 max-w-2xl text-lg text-white/75 md:text-xl">
              Fanzia is a Glendale-based AI and digital growth agency. We build
              custom technology, from intelligent websites to automated sales
              systems, that helps local businesses operate smarter and grow
              faster.
            </p>

            <dl className="mt-10 grid grid-cols-2 gap-0 border-[3px] border-brand-red">
              {FACTS.map((f, i) => (
                <div
                  key={f.k}
                  className={`bg-brand-ink p-5 ${i % 2 === 0 ? "border-r-[3px] border-brand-red" : ""} ${i < 2 ? "border-b-[3px] border-brand-red" : ""}`}
                >
                  <dt className="font-display text-[10px] uppercase tracking-[0.22em] text-brand-red">
                    {f.k}
                  </dt>
                  <dd className="mt-1 font-display text-lg uppercase tracking-tight text-white">
                    {f.v}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Right panel: big red card with logo + tagline */}
          <aside className="lg:col-span-5">
            <div className="relative h-full min-h-[480px] overflow-hidden bg-brand-red">
              <WavePattern
                className="pointer-events-none absolute inset-0 h-full w-full"
                stroke="#000"
                opacity={0.22}
                lines={24}
              />
              <div
                aria-hidden
                className="absolute inset-0"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(45deg, rgba(0,0,0,0.08) 0 2px, transparent 2px 18px)",
                }}
              />

              <div className="relative flex h-full flex-col items-center justify-center p-10 text-center">
                <Image
                  src="/brand/logo-white.png"
                  alt="Fanzia"
                  width={480}
                  height={130}
                  className="w-[220px] drop-shadow-[0_0_30px_rgba(0,0,0,0.35)] md:w-[300px]"
                />
                <p className="mt-8 max-w-xs font-display text-sm uppercase leading-relaxed tracking-[0.3em] text-black">
                  By the Fanz.
                  <br />
                  For the Fanz.
                </p>
              </div>

              {/* Corner ribbons */}
              <div className="absolute -left-4 top-6 rotate-[-3deg] bg-black px-5 py-1.5 font-display text-[10px] uppercase tracking-[0.28em] text-brand-red">
                Est. 2019
              </div>
              <div className="absolute -right-3 bottom-10 rotate-[3deg] bg-black px-5 py-1.5 font-display text-[10px] uppercase tracking-[0.28em] text-white">
                Glendale / LA
              </div>
            </div>
          </aside>
        </div>
      </div>
    </MotionSection>
  );
}
