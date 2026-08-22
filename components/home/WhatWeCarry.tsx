import Link from "next/link";
import MotionSection from "../MotionSection";

const CATEGORIES = [
  "Pokémon (US · Japanese · Chinese)",
  "Magic: The Gathering",
  "Basketball",
  "Soccer",
  "One Piece",
  "Other TCG",
];

export default function WhatWeCarry() {
  return (
    <MotionSection className="section bg-black text-white">
      <div className="container">
        <p className="eyebrow">What We Carry</p>
        <h2 className="h-section">
          Sealed product,
          <br />
          <span className="hl">every region.</span>
        </h2>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((c) => (
            <Link
              key={c}
              href="/products"
              className="card-dark flex items-center justify-between font-display text-lg uppercase tracking-tight text-white hover:text-brand-red md:text-xl"
            >
              {c}
              <span aria-hidden className="text-brand-red">
                &rarr;
              </span>
            </Link>
          ))}
        </div>

        <p className="mt-8 font-display text-xs uppercase tracking-[0.22em] text-white/50">
          Booster packs &middot; Booster boxes &middot; Bundles &middot; Sealed cases
        </p>

        <div className="mt-10">
          <Link href="/products" className="btn-ghost">
            See What We Carry
          </Link>
        </div>
      </div>
    </MotionSection>
  );
}
