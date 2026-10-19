import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import PageHeader from "@/components/PageHeader";
import MotionSection from "@/components/MotionSection";

export const metadata: Metadata = {
  title: "Policies",
  description:
    "Fanzia's MAP compliance, marketplace, authenticity, returns, and pickup policies.",
};

export default function PoliciesPage() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav />
      <main id="main" tabIndex={-1} className="bg-black text-white">
        <PageHeader eyebrow="Policies" title="Policies" />

        <MotionSection className="section pt-8">
          <div className="container max-w-3xl space-y-12">
            <Policy title="MAP Compliance">
              <p>
                Fanzia adheres to manufacturer and distributor Minimum Advertised Price policies
                across all channels.
              </p>
            </Policy>

            <Policy title="Marketplace Policy">
              {/* {{TODO: confirm this is accurate before publishing}} */}
              <p>
                Fanzia does not list or sell product on Amazon, eBay, or third-party consumer
                marketplaces.
              </p>
            </Policy>

            <Policy title="Authenticity">
              <p>All product is sourced through authorized channels and sold factory sealed.</p>
            </Policy>

            <Policy title="Returns">
              {/* {{TODO: returns terms}} */}
              <p>
                Factory-sealed product may be returned within 14 days of purchase if it remains
                unopened and in its original condition, accompanied by a receipt or order
                confirmation. Opened or resealed product is not eligible for return. Damaged or
                defective sealed product should be reported to{" "}
                <a className="text-brand-red" href="mailto:contact@fanzia.io">
                  contact@fanzia.io
                </a>{" "}
                within 48 hours of receipt.
              </p>
            </Policy>

            <Policy title="Pickup">
              {/* {{TODO: shipping terms}} */}
              <p>Retail orders can be picked up at the Glendale storefront during posted hours.</p>
            </Policy>

          </div>
        </MotionSection>
      </main>
      <Footer />
    </>
  );
}

function Policy({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-white/10 pt-8">
      <h2 className="font-display text-2xl uppercase tracking-tightest text-white">{title}</h2>
      <div className="mt-4 space-y-3 text-white/75">{children}</div>
    </div>
  );
}
