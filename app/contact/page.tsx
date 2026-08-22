import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import MotionSection from "@/components/MotionSection";
import ContactForm from "@/components/ContactForm";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get in touch with Fanzia — Glendale storefront address, phone, email, and hours. Wholesale and supply inquiries routed directly.",
};

export default function ContactPage() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav />
      <main id="main" tabIndex={-1} className="section bg-black pt-32 text-white md:pt-40">
        <div className="pointer-events-none absolute inset-0 grid-bg opacity-50" aria-hidden />
        <div className="container relative">
          <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-6">
              <p className="eyebrow">Contact</p>
              <h1 className="h-section">Get in touch.</h1>
              <p className="mt-6 max-w-lg text-lg text-white/70">
                Questions about the storefront, wholesale accounts, or supply parts &mdash; reach
                out and we&rsquo;ll route it to the right person.
              </p>

              <div className="mt-10 space-y-5">
                <ContactFact label="Address" value="320 N Verdugo Rd, Glendale, CA 91206" />
                <ContactFact label="Phone" value="(818) 796-3388" href="tel:+18187963388" />
                <ContactFact label="Email" value="contact@fanzia.io" href="mailto:contact@fanzia.io" />
                <ContactFact label="Hours" value="Tue–Sat, 11:00 AM – 6:00 PM · By appointment" />
              </div>

              <div className="mt-10 flex flex-wrap gap-4">
                <Link href="/wholesale" className="btn-ghost">
                  Wholesale Inquiries
                </Link>
                <Link href="/supply" className="btn-ghost">
                  Supply Inquiries
                </Link>
              </div>
            </div>

            <div className="lg:col-span-6">
              <ContactForm />
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

function ContactFact({ label, value, href }: { label: string; value: string; href?: string }) {
  const inner = (
    <>
      <span className="block font-display text-[10px] uppercase tracking-[0.3em] text-brand-red">{label}</span>
      <span className="mt-1 block font-display text-xl uppercase tracking-tight text-white md:text-2xl">
        {value}
      </span>
    </>
  );
  return (
    <div className="border-b border-white/10 pb-5">
      {href ? (
        <a href={href} className="block hover:text-brand-red">
          {inner}
        </a>
      ) : (
        inner
      )}
    </div>
  );
}
