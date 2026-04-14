"use client";

import MotionSection from "./MotionSection";

export default function About() {
  return (
    <MotionSection id="about" className="section bg-white">
      <div className="container grid gap-12 lg:grid-cols-2 lg:items-center">
        <div>
          <p className="eyebrow">About Fanzia</p>
          <h2 className="h-section">
            A Glendale-based team building growth infrastructure for local businesses.
          </h2>
          <p className="mt-6 text-lg text-brand-text/80">
            Fanzia is a Glendale-based AI and digital growth agency. We build
            custom technology, from intelligent websites to automated sales
            systems, that helps local businesses operate smarter and grow
            faster. Founded by George Kekejian.
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-2">
          {[
            { k: "Based in", v: "Glendale, CA" },
            { k: "Serving", v: "Los Angeles area" },
            { k: "Specialty", v: "AI & automation" },
            { k: "Founder", v: "George Kekejian" },
          ].map((item) => (
            <div
              key={item.k}
              className="rounded-xl border border-black/5 bg-brand-light p-5"
            >
              <dt className="text-xs font-semibold uppercase tracking-wide text-brand-accent">
                {item.k}
              </dt>
              <dd className="mt-1 text-lg font-semibold text-brand-primary">
                {item.v}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </MotionSection>
  );
}
