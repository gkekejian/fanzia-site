import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import PageHeader from "@/components/PageHeader";
import MotionSection from "@/components/MotionSection";
import WholesaleApplicationForm from "@/components/wholesale/WholesaleApplicationForm";

export const metadata: Metadata = {
  title: "Fanzia Wholesale",
  description:
    "One account. Every region. Fanzia consolidates US, Japanese, and Chinese trading card sourcing into a single wholesale account for independent retailers and operators.",
};

const PROBLEMS = [
  {
    title: "Fragmented sourcing.",
    copy: "US, Japanese, and Chinese product usually means three separate relationships, three sets of terms, and three lead times.",
  },
  {
    title: "Unpredictable allocation.",
    copy: "Release windows and allocation tiers make consistent supply hard to plan around.",
  },
  {
    title: "Minimums built for chains.",
    copy: "Case-quantity minimums don't fit independent retail footprints.",
  },
];

const AUDIENCE = [
  "Independent card shops",
  "Hobby and collectible retailers",
  "Multi-location retail operators",
  "Event and convention sellers",
];

const STEPS = [
  { n: "1", label: "Apply" },
  { n: "2", label: "Verification (1–3 business days)" },
  { n: "3", label: "Catalog access" },
  { n: "4", label: "Place orders" },
];

export default function WholesalePage() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav />
      <main id="main" tabIndex={-1} className="bg-black text-white">
        <PageHeader eyebrow="Wholesale" title="Fanzia Wholesale" deck="One account. Every region." />

        <MotionSection className="section pt-8">
          <div className="container grid gap-6 md:grid-cols-3">
            {PROBLEMS.map((p) => (
              <div key={p.title} className="card-dark">
                <h3 className="font-display text-xl uppercase leading-tight text-white">{p.title}</h3>
                <p className="mt-3 text-white/70">{p.copy}</p>
              </div>
            ))}
          </div>
        </MotionSection>

        <MotionSection className="section border-t border-white/10 bg-brand-ink">
          <div className="container">
            <p className="eyebrow">What We Do</p>
            <p className="mt-6 max-w-3xl text-lg text-white/80 md:text-xl">
              Fanzia consolidates US, Japanese, and Chinese trading card sourcing into a single wholesale account.
              We supply independent retailers and operators with sealed product across Pokémon, Magic: The
              Gathering, basketball, soccer, and other categories, in packs, boxes, bundles, and cases &mdash; with
              quantities and mixes sized for independent operations.
            </p>
          </div>
        </MotionSection>

        <MotionSection className="section border-t border-white/10">
          <div className="container grid gap-10 lg:grid-cols-2 lg:gap-16">
            <div>
              <p className="eyebrow">Who We Work With</p>
              <ul className="mt-6 space-y-3">
                {AUDIENCE.map((a) => (
                  <li key={a} className="border-t border-white/10 pt-3 text-lg text-white/80">
                    {a}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="eyebrow">How It Works</p>
              <ol className="mt-6 space-y-3">
                {STEPS.map((s) => (
                  <li key={s.n} className="flex items-baseline gap-4 border-t border-white/10 pt-3">
                    <span className="font-display text-2xl text-brand-red">{s.n}</span>
                    <span className="text-lg text-white/80">{s.label}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </MotionSection>

        <MotionSection className="section border-t border-white/10 bg-brand-ink">
          <div className="container max-w-3xl">
            <p className="eyebrow">Apply</p>
            <h2 className="h-section">Wholesale Application</h2>
            <p className="mt-6 max-w-xl text-white/70">
              Mirrors what our own distributors ask for &mdash; it helps us verify and approve accounts faster.
            </p>
            <div className="mt-10">
              <WholesaleApplicationForm />
            </div>
          </div>
        </MotionSection>
      </main>
      <Footer />
    </>
  );
}
