import Link from "next/link";
import MotionSection from "../MotionSection";

export default function Locations() {
  return (
    <MotionSection className="section bg-brand-ink text-white">
      <div className="container">
        <p className="eyebrow">Our Locations</p>
        <h2 className="h-section">
          Find us in
          <br />
          <span className="hl">Southern California.</span>
        </h2>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <div className="card-dark">
            <span className="font-display text-[10px] uppercase tracking-[0.24em] text-brand-red">
              Storefront
            </span>
            <h3 className="mt-3 font-display text-3xl uppercase leading-tight text-white">
              Fanzia Glendale
            </h3>
            <p className="mt-3 text-white/70">
              320 N Verdugo Rd, Glendale, CA 91206
            </p>
            <p className="mt-1 text-white/70">
              {/* {{TODO: confirm hours}} */}
              Tue&ndash;Sat, 11:00 AM &ndash; 6:00 PM &middot; Appointments welcome
            </p>
            <Link
              href="/store"
              className="mt-6 inline-block font-display text-sm uppercase tracking-[0.2em] text-brand-red underline decoration-2 underline-offset-4 hover:text-white"
            >
              Get directions &amp; hours
            </Link>
          </div>

          <div className="card-dark">
            <span className="font-display text-[10px] uppercase tracking-[0.24em] text-brand-red">
              Retail location
            </span>
            <h3 className="mt-3 font-display text-3xl uppercase leading-tight text-white">
              Lakewood Center
            </h3>
            <p className="mt-3 text-white/70">Lakewood, CA</p>
            <p className="mt-1 text-white/70">
              Additional Southern California retail locations opening
              through 2026.
            </p>
            <Link
              href="/store"
              className="mt-6 inline-block font-display text-sm uppercase tracking-[0.2em] text-brand-red underline decoration-2 underline-offset-4 hover:text-white"
            >
              View all locations
            </Link>
          </div>
        </div>
      </div>
    </MotionSection>
  );
}
