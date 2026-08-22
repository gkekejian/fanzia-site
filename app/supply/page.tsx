import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import PageHeader from "@/components/PageHeader";
import MotionSection from "@/components/MotionSection";
import PartsQuoteForm from "@/components/supply/PartsQuoteForm";

export const metadata: Metadata = {
  title: "Fanzia Supply",
  description:
    "Hardware and parts for card retail dispensing equipment: high-capacity coils, bundle support bars, and TCN-series replacement parts.",
};

const PRODUCTS = [
  {
    name: "High-capacity coils",
    copy: "Coils sized for booster pack and bundle dimensions, increasing capacity per row over standard configurations.",
  },
  {
    name: "Bundle support bars",
    copy: "Support hardware for reliable bundle dispensing.",
  },
  {
    name: "TCN-series replacement parts",
    copy: "Replacement and upgrade parts for TCN-series equipment.",
  },
  {
    // {{TODO: additional SKUs}}
    name: "Additional hardware",
    copy: "Additional part numbers to be listed as they're confirmed.",
  },
];

export default function SupplyPage() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav />
      <main id="main" tabIndex={-1} className="bg-black text-white">
        <PageHeader
          eyebrow="Supply"
          title="Fanzia Supply"
          deck="Hardware and parts for card retail dispensing equipment."
        />

        <MotionSection className="section pt-8">
          <div className="container">
            <p className="max-w-2xl text-lg text-white/75">
              Retail dispensing equipment isn&rsquo;t built for trading cards. Standard configurations
              can&rsquo;t hold booster pack volume and won&rsquo;t reliably dispense bundles. Fanzia
              Supply carries the parts that fix that.
            </p>
          </div>
        </MotionSection>

        <MotionSection className="section border-t border-white/10 bg-brand-ink">
          <div className="container grid gap-6 md:grid-cols-2">
            {PRODUCTS.map((p) => (
              <div key={p.name} className="card-dark">
                <h2 className="font-display text-2xl uppercase leading-tight text-white">{p.name}</h2>
                <p className="mt-3 text-white/70">{p.copy}</p>
              </div>
            ))}
          </div>
        </MotionSection>

        <MotionSection className="section border-t border-white/10">
          <div className="container max-w-3xl">
            <p className="eyebrow">Request a Quote</p>
            <h2 className="h-section">Request a Parts Quote</h2>
            <div className="mt-10">
              <PartsQuoteForm />
            </div>
          </div>
        </MotionSection>
      </main>
      <Footer />
    </>
  );
}
