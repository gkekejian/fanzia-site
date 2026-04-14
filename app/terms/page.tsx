import type { Metadata } from "next";
import Footer from "@/components/Footer";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms of service for Fanzia, Inc.",
};

export default function TermsPage() {
  return (
    <>
      <Nav />
      <main className="bg-black pt-32 pb-20 text-white">
        <div className="container max-w-3xl">
          <p className="eyebrow">Legal</p>
          <h1 className="display mt-4 text-5xl text-white md:text-6xl">
            Terms of Service
          </h1>
          <p className="mt-3 text-sm text-white/50">
            Last updated: {new Date().getFullYear()}
          </p>

          <div className="mt-10 space-y-6 text-white/80">
            <p>
              By accessing fanzia.io you agree to these terms. All content on
              this site is provided for informational purposes only and does
              not constitute a contract for services. Engagements with Fanzia,
              Inc. are governed by separate signed agreements.
            </p>
            <h2 className="mt-10 font-display text-2xl uppercase tracking-tightest text-white">
              Intellectual Property
            </h2>
            <p>
              All trademarks, logos, and content on this site are the property
              of Fanzia, Inc. or used with permission. You may not reproduce,
              distribute, or create derivative works without written consent.
            </p>
            <h2 className="mt-10 font-display text-2xl uppercase tracking-tightest text-white">
              Limitation of Liability
            </h2>
            <p>
              Fanzia, Inc. provides this site on an as-is basis and makes no
              warranties regarding availability, accuracy, or fitness for any
              particular purpose.
            </p>
            <h2 className="mt-10 font-display text-2xl uppercase tracking-tightest text-white">
              Contact
            </h2>
            <p>
              Questions about these terms can be sent to{" "}
              <a className="text-brand-red" href="mailto:contact@fanzia.io">
                contact@fanzia.io
              </a>
              .
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
