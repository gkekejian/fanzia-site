"use client";

import Image from "next/image";
import MotionSection from "./MotionSection";

const FACTS = [
  { k: "Based in", v: "Glendale, CA" },
  { k: "Serving", v: "Los Angeles area" },
  { k: "Specialty", v: "AI & Automation" },
  { k: "HQ", v: "Los Angeles, CA" },
];

export default function About() {
  return (
    <MotionSection id="about" className="section bg-brand-cream text-black">
      <div className="container">
        <div className="grid gap-12 lg:grid-cols-12 lg:items-start lg:gap-16">
          <div className="lg:col-span-7">
            <p className="eyebrow">About</p>
            <h2 className="h-section-light">
              A Glendale team building <span className="text-brand-red">growth infrastructure</span>{" "}
              for local business.
            </h2>
            <p className="mt-8 max-w-2xl text-lg text-black/75 md:text-xl">
              Fanzia is a Glendale-based AI and digital growth agency. We build
              custom technology, from intelligent websites to automated sales
              systems, that helps local businesses operate smarter and grow
              faster.
            </p>

            <dl className="mt-10 grid grid-cols-2 gap-0 border-2 border-black">
              {FACTS.map((f, i) => (
                <div
                  key={f.k}
                  className={`bg-white p-5 ${i % 2 === 0 ? "border-r-2 border-black" : ""} ${i < 2 ? "border-b-2 border-black" : ""}`}
                >
                  <dt className="font-display text-[10px] uppercase tracking-[0.22em] text-brand-red">
                    {f.k}
                  </dt>
                  <dd className="mt-1 font-display text-lg uppercase tracking-tight">
                    {f.v}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <aside className="lg:col-span-5">
            <div className="relative aspect-square w-full overflow-hidden bg-black">
              <Image
                src="/brand/logo-white.png"
                alt="Fanzia"
                fill
                sizes="(min-width: 1024px) 40vw, 100vw"
                className="object-contain p-16"
              />
              <div
                aria-hidden
                className="absolute inset-0"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(45deg, rgba(241,55,55,0.12) 0 2px, transparent 2px 18px)",
                }}
              />
            </div>
            <div className="-mt-4 ml-4 bg-brand-red p-5 font-display text-sm uppercase tracking-[0.2em] text-white">
              By the Fanz, for the Fanz.
            </div>
          </aside>
        </div>
      </div>
    </MotionSection>
  );
}
