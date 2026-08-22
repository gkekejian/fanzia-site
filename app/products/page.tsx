import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import PageHeader from "@/components/PageHeader";
import MotionSection from "@/components/MotionSection";

export const metadata: Metadata = {
  title: "What We Carry",
  description:
    "Sealed trading card product across Pokémon, Magic: The Gathering, basketball, soccer, One Piece, and more — sourced from US, Japanese, and Chinese print runs.",
};

const CATEGORIES = [
  {
    name: "Pokémon",
    copy: "US English, Japanese, and Chinese print runs. Booster packs, booster boxes, elite trainer boxes, bundles, and sealed cases.",
  },
  {
    name: "Magic: The Gathering",
    copy: "Standard sets, Commander product, collector and set boosters, bundles, and cases.",
  },
  {
    name: "Basketball",
    copy: "Licensed sports product in packs, boxes, and bundles.",
  },
  {
    name: "Soccer",
    copy: "Domestic and international licensed releases in packs, boxes, and bundles.",
  },
  {
    name: "One Piece & Other TCG",
    copy: "Additional trading card categories carried by request and seasonal availability.",
  },
];

export default function ProductsPage() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav />
      <main id="main" tabIndex={-1} className="bg-black text-white">
        <PageHeader
          eyebrow="Products"
          title="What We Carry"
          deck="Sealed product across the major trading card categories, sourced from US, Japanese, and Chinese print runs."
        />

        <MotionSection className="section pt-8">
          <div className="container space-y-16">
            {CATEGORIES.map((cat) => (
              <div
                key={cat.name}
                className="grid gap-6 border-t border-white/10 pt-10 md:grid-cols-12 md:gap-10"
              >
                <h2 className="md:col-span-4 font-display text-3xl uppercase leading-tight text-white md:text-4xl">
                  {cat.name}
                </h2>
                <p className="md:col-span-8 max-w-2xl text-lg text-white/75">{cat.copy}</p>
              </div>
            ))}
          </div>
        </MotionSection>

        <MotionSection className="border-y border-white/10 bg-brand-ink py-10">
          <div className="container">
            <p className="font-display text-sm uppercase tracking-[0.22em] text-white/70">
              Packs &middot; Boxes &middot; Bundles &middot; Cases
            </p>
          </div>
        </MotionSection>

        <MotionSection className="section">
          <div className="container">
            <p className="max-w-2xl text-white/60">
              Inventory rotates with release schedules and allocation.
              Contact the store for current availability.
            </p>
          </div>
        </MotionSection>
      </main>
      <Footer />
    </>
  );
}
