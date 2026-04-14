"use client";

import Image from "next/image";
import MotionSection from "./MotionSection";

const FACTS = [
  { k: "Location", v: "Lakewood Center Mall" },
  { k: "Category", v: "Toys & Novelty" },
  { k: "Payment", v: "Cashless / Tap" },
  { k: "Operator", v: "Fanzia, Inc." },
];

/**
 * VendToyz is a Fanzia-owned retail operation, not a client service.
 * This section is intentionally set apart so visitors (especially
 * distributors) understand it is a standalone venture.
 */
export default function Retail() {
  return (
    <MotionSection
      id="retail"
      className="relative overflow-hidden bg-brand-red py-24 text-white md:py-32 noise"
    >
      {/* Diagonal hatched background stripe */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, #000 0 2px, transparent 2px 22px)",
        }}
      />

      <div className="container relative">
        <div className="flex items-center gap-4">
          <span className="h-2 w-2 bg-black" />
          <span className="font-display text-xs uppercase tracking-[0.3em] text-black">
            Separate Retail Operation
          </span>
          <span className="h-px flex-1 bg-black/30" />
        </div>

        <div className="mt-10 grid gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <h2 className="display text-7xl text-black md:text-8xl lg:text-[9rem]">
              Vend
              <br />
              Toyz.
            </h2>
            <p className="mt-6 max-w-md text-lg font-semibold text-black">
              A Fanzia-owned retail venture. Branded toy and novelty vending
              machines operating at Lakewood Center Mall, powered by cashless
              payment technology.
            </p>
            <p className="mt-5 max-w-md text-base text-black/80">
              VendToyz is <span className="font-bold underline decoration-2 underline-offset-4">not a service we sell</span>.
              It is a live retail business that Fanzia, Inc. owns and operates.
              Distributors, mall operators, and supply partners can engage with
              VendToyz directly.
            </p>

            <dl className="mt-8 grid grid-cols-2 gap-0 border-2 border-black bg-black/5">
              {FACTS.map((f, i) => (
                <div
                  key={f.k}
                  className={`p-4 ${i % 2 === 0 ? "border-r-2 border-black" : ""} ${i < 2 ? "border-b-2 border-black" : ""}`}
                >
                  <dt className="font-display text-[10px] uppercase tracking-[0.22em] text-black/70">
                    {f.k}
                  </dt>
                  <dd className="mt-1 font-display text-sm uppercase text-black">
                    {f.v}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="mt-8 flex flex-wrap gap-4">
              <a href="#contact" className="btn-dark">
                Distributor Inquiries
              </a>
              <a
                href="#services"
                className="inline-flex items-center justify-center border-2 border-black bg-transparent px-7 py-4 font-display text-base uppercase tracking-wider text-black transition hover:bg-black hover:text-brand-red"
              >
                Back to Services
              </a>
            </div>
          </div>

          <div className="lg:col-span-7">
            <div className="grid grid-cols-5 grid-rows-6 gap-3 md:gap-4">
              <figure className="col-span-3 row-span-6 relative overflow-hidden border-4 border-black bg-black">
                <Image
                  src="/retail/vendtoyz-hotwheels.jpg"
                  alt="VendToyz Hot Wheels themed vending machine at Lakewood Center Mall"
                  width={1200}
                  height={1600}
                  className="h-full w-full object-cover"
                />
                <figcaption className="absolute bottom-0 left-0 right-0 bg-black/80 px-3 py-2 font-display text-[10px] uppercase tracking-[0.22em] text-white">
                  Hot Wheels // Lakewood
                </figcaption>
              </figure>
              <figure className="col-span-2 row-span-4 relative overflow-hidden border-4 border-black bg-black">
                <Image
                  src="/retail/vendtoyz-yellow.png"
                  alt="VendToyz What Kidz Want plush vending machine"
                  width={800}
                  height={1200}
                  className="h-full w-full object-cover"
                />
                <figcaption className="absolute bottom-0 left-0 right-0 bg-black/80 px-3 py-2 font-display text-[10px] uppercase tracking-[0.22em] text-white">
                  What Kidz Want
                </figcaption>
              </figure>
              <div className="col-span-2 row-span-2 flex flex-col justify-between border-4 border-black bg-black p-5 text-white">
                <span className="font-display text-[10px] uppercase tracking-[0.22em] text-brand-red">
                  Live Locations
                </span>
                <span className="font-display text-6xl leading-none">2+</span>
                <span className="font-display text-[10px] uppercase tracking-[0.22em] text-white/70">
                  and growing
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </MotionSection>
  );
}
