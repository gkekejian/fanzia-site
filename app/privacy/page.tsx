import type { Metadata } from "next";
import Footer from "@/components/Footer";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy policy for Fanzia, Inc.",
};

export default function PrivacyPage() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav />
      <main id="main" tabIndex={-1} className="bg-black pt-32 pb-20 text-white">
        <div className="container max-w-3xl">
          <p className="eyebrow">Legal</p>
          <h1 className="display mt-4 text-5xl text-white md:text-6xl">
            Privacy Policy
          </h1>
          <p className="mt-3 text-sm text-white/50">
            Last updated: {new Date().getFullYear()}
          </p>

          <div className="mt-10 space-y-6 text-white/80">
            <p>
              Fanzia, Inc. respects your privacy. This policy explains what
              information we collect when you use fanzia.io and how we use it.
            </p>
            <h2 className="mt-10 font-display text-2xl uppercase tracking-tightest text-white">
              Information We Collect
            </h2>
            <p>
              When you submit the contact form we collect your name, email,
              phone number, and the contents of your message. We use this
              information solely to respond to your inquiry.
            </p>
            <h2 className="mt-10 font-display text-2xl uppercase tracking-tightest text-white">
              Analytics
            </h2>
            <p>
              We may use privacy-respecting analytics to measure aggregate
              traffic. We do not sell personal information.
            </p>
            <h2 className="mt-10 font-display text-2xl uppercase tracking-tightest text-white">
              Contact
            </h2>
            <p>
              Requests to access or delete your information can be sent to{" "}
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
