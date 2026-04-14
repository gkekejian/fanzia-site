"use client";

import MotionSection from "./MotionSection";

/**
 * VendToyz is a Fanzia-owned retail operation, not a client service.
 * This section is intentionally set apart so visitors (especially
 * distributors) understand it is a standalone venture.
 *
 * PHOTOS below are stock placeholders via picsum.photos (reliable, no auth).
 * Swap with real VendToyz machine photos when available by replacing the
 * `src` values. Keep the same aspect ratios in the grid cells.
 */
const PHOTOS = [
  {
    src: "https://picsum.photos/seed/vendtoyz-mall/1200/900",
    alt: "Placeholder image for VendToyz machines in a mall setting",
  },
  {
    src: "https://picsum.photos/seed/vendtoyz-toys/800/800",
    alt: "Placeholder image representing toy and novelty inventory",
  },
  {
    src: "https://picsum.photos/seed/vendtoyz-concourse/800/800",
    alt: "Placeholder image representing mall concourse foot traffic",
  },
];

const FACTS = [
  { k: "Location", v: "Lakewood Center Mall" },
  { k: "Category", v: "Toys & Novelty" },
  { k: "Payment", v: "Cashless / Tap" },
  { k: "Operator", v: "Fanzia, Inc." },
];

export default function Retail() {
  return (
    <MotionSection
      id="retail"
      className="relative overflow-hidden bg-brand-primary py-24 text-white md:py-32"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background:
            "radial-gradient(55% 45% at 85% 15%, rgba(233,69,96,0.22) 0%, rgba(233,69,96,0) 65%), radial-gradient(45% 40% at 10% 90%, rgba(22,33,62,0.85) 0%, rgba(26,26,46,0) 70%)",
        }}
      />

      <div className="container relative">
        <div className="flex flex-col items-start gap-12 lg:flex-row lg:items-stretch">
          <div className="lg:w-5/12">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-accent/40 bg-brand-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-brand-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-accent" />
              Separate Retail Operation
            </div>

            <h2 className="mt-6 text-3xl font-bold leading-tight md:text-4xl lg:text-5xl">
              VendToyz
            </h2>
            <p className="mt-3 text-lg text-white/70">
              A Fanzia-owned retail venture. Branded toy and novelty vending
              machines operating at Lakewood Center Mall, powered by cashless
              payment technology.
            </p>

            <p className="mt-6 text-base text-white/70">
              VendToyz is <span className="font-semibold text-white">not a service we sell</span>.
              It is a live retail business that Fanzia, Inc. owns and operates.
              Distributors, mall operators, and supply partners can engage with
              VendToyz directly.
            </p>

            <dl className="mt-8 grid grid-cols-2 gap-3">
              {FACTS.map((f) => (
                <div
                  key={f.k}
                  className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur"
                >
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-accent">
                    {f.k}
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-white">
                    {f.v}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#contact" className="btn-primary">
                Distributor Inquiries
              </a>
              <a href="#services" className="btn-outline">
                Back to Fanzia Services
              </a>
            </div>
          </div>

          <div className="lg:w-7/12">
            <div className="grid grid-cols-6 grid-rows-2 gap-3 sm:gap-4">
              <figure className="col-span-6 row-span-2 overflow-hidden rounded-2xl border border-white/10 bg-white/5 sm:col-span-4">
                <img
                  src={PHOTOS[0].src}
                  alt={PHOTOS[0].alt}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </figure>
              <figure className="col-span-3 overflow-hidden rounded-2xl border border-white/10 bg-white/5 sm:col-span-2">
                <img
                  src={PHOTOS[1].src}
                  alt={PHOTOS[1].alt}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </figure>
              <figure className="col-span-3 overflow-hidden rounded-2xl border border-white/10 bg-white/5 sm:col-span-2">
                <img
                  src={PHOTOS[2].src}
                  alt={PHOTOS[2].alt}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </figure>
            </div>

            <p className="mt-4 text-xs text-white/40">
              Photography shown for illustration. Real in-mall installation
              photos available on request.
            </p>
          </div>
        </div>
      </div>
    </MotionSection>
  );
}
