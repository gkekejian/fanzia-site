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
      <Nav />
      <main className="pt-32 pb-20">
        <div className="container max-w-3xl">
          <h1 className="text-4xl font-bold text-brand-primary">
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-brand-text/60">
            Last updated: {new Date().getFullYear()}
          </p>

          <div className="prose mt-8 max-w-none text-brand-text/80">
            <p>
              Fanzia, Inc. respects your privacy. This policy explains what
              information we collect when you use fanzia.io and how we use it.
            </p>
            <h2 className="mt-8 text-2xl font-bold text-brand-primary">
              Information We Collect
            </h2>
            <p>
              When you submit the contact form we collect your name, email,
              phone number, and the contents of your message. We use this
              information solely to respond to your inquiry.
            </p>
            <h2 className="mt-8 text-2xl font-bold text-brand-primary">
              Analytics
            </h2>
            <p>
              We may use privacy-respecting analytics to measure aggregate
              traffic. We do not sell personal information.
            </p>
            <h2 className="mt-8 text-2xl font-bold text-brand-primary">
              Contact
            </h2>
            <p>
              Requests to access or delete your information can be sent to{" "}
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
