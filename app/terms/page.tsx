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
      <main className="pt-32 pb-20">
        <div className="container max-w-3xl">
          <h1 className="text-4xl font-bold text-brand-primary">
            Terms of Service
          </h1>
          <p className="mt-2 text-sm text-brand-text/60">
            Last updated: {new Date().getFullYear()}
          </p>

          <div className="prose mt-8 max-w-none text-brand-text/80">
            <p>
              By accessing fanzia.io you agree to these terms. All content on
              this site is provided for informational purposes only and does
              not constitute a contract for services. Engagements with Fanzia,
              Inc. are governed by separate signed agreements.
            </p>
            <h2 className="mt-8 text-2xl font-bold text-brand-primary">
              Intellectual Property
            </h2>
            <p>
              All trademarks, logos, and content on this site are the property
              of Fanzia, Inc. or used with permission. You may not reproduce,
              distribute, or create derivative works without written consent.
            </p>
            <h2 className="mt-8 text-2xl font-bold text-brand-primary">
              Limitation of Liability
            </h2>
            <p>
              Fanzia, Inc. provides this site on an as-is basis and makes no
              warranties regarding availability, accuracy, or fitness for any
              particular purpose.
            </p>
            <h2 className="mt-8 text-2xl font-bold text-brand-primary">
              Contact
            </h2>
            <p>
              Questions about these terms can be sent to{" "}
              <a
                className="text-brand-accent"
                href="mailto:hello@fanzia.io"
              >
                hello@fanzia.io
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
