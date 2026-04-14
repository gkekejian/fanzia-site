"use client";

import Image from "next/image";
import MotionSection from "./MotionSection";
import WavePattern from "./WavePattern";

const FACTS = [
  { k: "Location", v: "Lakewood Center" },
  { k: "Category", v: "Toys & Novelty" },
  { k: "Payment", v: "Cashless Tap" },
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
      className="relative overflow-hidden bg-black text-white"
    >
      {/* Divider strip */}
      <div className="h-3 w-full bg-brand-red" />

      <div className="relative bg-brand-red py-20 md:py-28">
        <WavePattern
          className="pointer-events-none absolute inset-0 h-full w-full"
          stroke="#000"
          opacity={0.22}
          lines={30}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, rgba(0,0,0,0.08) 0 2px, transparent 2px 22px)",
          }}
        />

        <div className="container relative">
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-2 bg-black px-3 py-1.5 font-display text-[11px] uppercase tracking-[0.3em] text-brand-red">
              <span className="h-1.5 w-1.5 bg-brand-red" />
              Separate Retail Operation
            </span>
            <span className="h-px flex-1 bg-black/30" />
            <span className="hidden font-display text-[11px] uppercase tracking-[0.3em] text-black md:inline">
              Fanzia Venture 001
            </span>
          </div>

          <div className="mt-10 grid gap-10 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-5 lg:pt-6">
              <h2 className="display text-[5rem] leading-[0.88] text-black sm:text-[7rem] md:text-[9rem] lg:text-[10rem]">
                Vend
                <br />
                Toyz.
              </h2>
              <p className="mt-8 max-w-md text-lg font-semibold text-black md:text-xl">
                A Fanzia-owned retail venture. Branded toy and novelty vending
                machines operating at Lakewood Center Mall, powered by cashless
                payment technology.
              </p>
              <p className="mt-5 max-w-md text-base text-black/80">
                VendToyz is{" "}
                <span className="bg-black px-1.5 text-brand-red">not a service we sell</span>.
                It is a live retail business that Fanzia, Inc. owns and operates.
                Distributors, mall operators, and supply partners can engage with
                VendToyz directly.
              </p>

              <dl className="mt-8 grid grid-cols-2 gap-0 border-[3px] border-black bg-black/5">
                {FACTS.map((f, i) => (
                  <div
                    key={f.k}
                    className={`p-4 ${i % 2 === 0 ? "border-r-[3px] border-black" : ""} ${i < 2 ? "border-b-[3px] border-black" : ""}`}
                  >
                    <dt className="font-display text-[10px] uppercase tracking-[0.22em] text-black/70">
                      {f.k}
                    </dt>
                    <dd className="mt-1 font-display text-base uppercase tracking-tight text-black">
                      {f.v}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="mt-8 flex flex-wrap gap-4">
                <a
                  href="#contact"
                  className="inline-flex items-center justify-center gap-2 bg-black px-7 py-4 font-display text-base uppercase tracking-wider text-white shadow-[6px_6px_0_0_rgba(0,0,0,0.3)] transition hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-[3px_3px_0_0_rgba(0,0,0,0.3)]"
                >
                  Distributor Inquiries
                </a>
              </div>
            </div>

            {/* Big side-by-side photos, full aspect */}
            <div className="lg:col-span-7">
              <div className="grid grid-cols-2 gap-4 md:gap-5">
                <figure className="relative overflow-hidden border-[6px] border-black bg-black">
                  <div className="aspect-[3/4]">
                    <Image
                      src="/retail/vendtoyz-hotwheels.jpg"
                      alt="VendToyz Hot Wheels themed vending machine at Lakewood Center Mall"
                      width={900}
                      height={1200}
                      className="h-full w-full object-cover"
                      priority
                    />
                  </div>
                  <figcaption className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-black px-3 py-2 font-display text-[10px] uppercase tracking-[0.22em] text-white">
                    <span>Hot Wheels</span>
                    <span className="text-brand-red">Lakewood</span>
                  </figcaption>
                </figure>
                <figure className="relative overflow-hidden border-[6px] border-black bg-black">
                  <div className="aspect-[3/4]">
                    <Image
                      src="/retail/vendtoyz-yellow.png"
                      alt="VendToyz What Kidz Want plush vending machine"
                      width={900}
                      height={1200}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <figcaption className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-black px-3 py-2 font-display text-[10px] uppercase tracking-[0.22em] text-white">
                    <span>What Kidz Want</span>
                    <span className="text-brand-red">Live</span>
                  </figcaption>
                </figure>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-4 md:gap-5">
                <div className="border-[6px] border-black bg-black p-5 text-white">
                  <span className="block font-display text-[10px] uppercase tracking-[0.22em] text-brand-red">
                    Live Locations
                  </span>
                  <span className="mt-2 block font-display text-5xl leading-none md:text-6xl">
                    2+
                  </span>
                  <span className="mt-1 block font-display text-[10px] uppercase tracking-[0.22em] text-white/60">
                    and growing
                  </span>
                </div>
                <div className="border-[6px] border-black bg-black p-5 text-white">
                  <span className="block font-display text-[10px] uppercase tracking-[0.22em] text-brand-red">
                    Payment
                  </span>
                  <span className="mt-2 block font-display text-2xl leading-tight md:text-3xl">
                    Cashless
                    <br />
                    Tap
                  </span>
                </div>
                <div className="border-[6px] border-black bg-black p-5 text-white">
                  <span className="block font-display text-[10px] uppercase tracking-[0.22em] text-brand-red">
                    Inquiries
                  </span>
                  <a
                    href="#contact"
                    className="mt-2 block font-display text-base leading-tight text-white underline decoration-brand-red decoration-2 underline-offset-4 md:text-lg"
                  >
                    hello@fanzia.io
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="h-3 w-full bg-brand-red" />
    </MotionSection>
  );
}
