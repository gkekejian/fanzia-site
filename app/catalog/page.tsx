import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import PageHeader from "@/components/PageHeader";
import MotionSection from "@/components/MotionSection";
import CatalogAccessForm from "@/components/catalog/CatalogAccessForm";
import OrderForm from "@/components/catalog/OrderForm";
import CatalogDownload from "@/components/catalog/CatalogDownload";

export const metadata: Metadata = {
  title: "Catalog & Ordering",
  description:
    "Request access to the Fanzia wholesale catalog, or place an order request if your account is already approved.",
};

export default function CatalogPage() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav />
      <main id="main" tabIndex={-1} className="bg-black text-white">
        <PageHeader
          eyebrow="Catalog"
          title="Catalog & Ordering"
          deck="The Fanzia wholesale catalog is available to approved accounts. Approved buyers receive current availability, formats, and pricing, and can submit orders directly."
        />

        <MotionSection className="section pt-8">
          <div className="container">
            <CatalogDownload />
          </div>
        </MotionSection>

        <MotionSection className="section border-t border-white/10 bg-brand-ink">
          <div className="container max-w-3xl">
            <p className="eyebrow">Not Approved Yet</p>
            <h2 className="h-section">Request Catalog Access</h2>
            <p className="mt-6 text-white/70">Already approved? Use the order form below.</p>
            <div className="mt-10">
              <CatalogAccessForm />
            </div>
          </div>
        </MotionSection>

        <MotionSection className="section border-t border-white/10">
          <div className="container max-w-3xl">
            <p className="eyebrow">Approved Accounts</p>
            <h2 className="h-section">Place an Order</h2>
            <div className="mt-10">
              <OrderForm />
            </div>
          </div>
        </MotionSection>
      </main>
      <Footer />
    </>
  );
}
