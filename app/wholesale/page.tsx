import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import PageHeader from "@/components/PageHeader";
import MotionSection from "@/components/MotionSection";
import WaitlistForm from "@/components/wholesale/WaitlistForm";
import { getApplicationsOpen, PORTAL_BASE } from "@/lib/portalStatus";

export const metadata: Metadata = {
  title: "Wholesale: Japanese & Chinese TCG",
  description:
    "Wholesale sealed Japanese- and Chinese-language trading card product for vending operators, live sellers, and specialty retailers. $500 minimum. Pay before we buy.",
};

// Re-check the portal toggle every 5 minutes (ISR), so flipping it in the
// admin updates this page without a deploy.
export const revalidate = 300;

// Copy must match what Fanzia can actually source today. Do not add US /
// English-language or sports product here until supply is contracted:
// advertising product you can't fill creates support tickets and FTC risk.
const FOR_WHO = [
  { title: "Vending operators", copy: "Pack and box formats sized for machines, reordered on a cadence." },
  { title: "Live sellers", copy: "Whatnot and TikTok Live breakers who need Japanese and Chinese product in volume." },
  { title: "Specialty retail", copy: "Asian specialty, hobby, and card shops adding import TCG to the shelf." },
];

const STEPS = [
  { n: "01", label: "Apply or join the waitlist", copy: "Business buyers only. Resale certificate required." },
  { n: "02", label: "Get verified", copy: "We review accounts in batches and email you the result." },
  { n: "03", label: "Order in the portal", copy: "Live pricing and availability. Add to cart, submit." },
  { n: "04", label: "Pay, then we ship", copy: "Card, ACH, or wire. We buy after your payment clears, then ship from Glendale." },
];

// Answers the questions that otherwise arrive as emails. Every number here
// is enforced in platform/lib/invoicing/rules.ts; change both together.
const FAQ = [
  { q: "What's the minimum order?", a: "$500 per order. Orders under $750 carry a $25 small-order fee. First orders are capped at $5,000." },
  { q: "Is this English product?", a: "No. Everything we sell is Japanese- or Chinese-language import edition, and every order asks you to acknowledge that at checkout." },
  { q: "How do I pay?", a: "By card in the portal, or by ACH or wire using the details on your invoice. We place supplier orders only after your payment clears. No credit terms." },
  { q: "How long does it take?", a: "Orders ship from Glendale, CA once product is in hand. Import lead times depend on the supplier and customs, so treat any date as an estimate." },
  { q: "Returns?", a: "Wholesale sales are final. Shipping damage, short counts, or wrong items are handled as claims through the portal." },
  { q: "Are you an authorized distributor?", a: "No. Fanzia is an independent import and sourcing business, not affiliated with or endorsed by any trading card publisher." },
];

export default async function WholesalePage() {
  const open = await getApplicationsOpen();

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav />
      <main id="main" tabIndex={-1} className="bg-black text-white">
        <PageHeader
          eyebrow="Wholesale"
          title="Japanese & Chinese TCG, wholesale."
          deck="Sealed import product for vending operators, live sellers, and specialty retail. Consolidated in Glendale, shipped to you. Pay before we buy: no credit, no surprises."
        />

        {/* Primary action sits above the fold, state-aware. */}
        <section className="section pt-0" aria-labelledby="cta-heading">
          <div className="container">
            <div className="flex flex-col gap-4 border border-white/15 bg-brand-ink p-6 md:flex-row md:items-center md:justify-between md:p-8">
              <div>
                <h2 id="cta-heading" className="font-display text-xl uppercase text-white">
                  {open ? "Applications are open" : "New accounts open in batches"}
                </h2>
                <p className="mt-1 text-white/70">
                  {open
                    ? "Takes about 5 minutes. Have your resale certificate ready to upload."
                    : "Join the waitlist in 20 seconds. We'll email you when the next batch opens."}
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                {open ? (
                  <a href={`${PORTAL_BASE}/apply`} className="btn-primary min-h-[52px] text-center">
                    Start application
                  </a>
                ) : (
                  <a href="#waitlist" className="btn-primary min-h-[52px] text-center">
                    Join the waitlist
                  </a>
                )}
                <a href={`${PORTAL_BASE}/member/login`} className="btn-ghost min-h-[52px] text-center">
                  Buyer sign in
                </a>
              </div>
            </div>
          </div>
        </section>

        <MotionSection className="section border-t border-white/10">
          <div className="container">
            <p className="eyebrow">Who it&rsquo;s for</p>
            <ul className="mt-8 grid gap-6 md:grid-cols-3">
              {FOR_WHO.map((f) => (
                <li key={f.title} className="card-dark">
                  <h3 className="font-display text-xl uppercase leading-tight text-white">{f.title}</h3>
                  <p className="mt-3 text-white/70">{f.copy}</p>
                </li>
              ))}
            </ul>
          </div>
        </MotionSection>

        <MotionSection className="section border-t border-white/10 bg-brand-ink">
          <div className="container">
            <p className="eyebrow">How it works</p>
            <ol className="mt-8 grid gap-6 md:grid-cols-4">
              {STEPS.map((s) => (
                <li key={s.n} className="border-t-2 border-brand-red pt-4">
                  <span className="font-display text-sm text-brand-red">{s.n}</span>
                  <p className="mt-2 font-display text-lg uppercase leading-tight text-white">{s.label}</p>
                  <p className="mt-2 text-sm text-white/65">{s.copy}</p>
                </li>
              ))}
            </ol>
          </div>
        </MotionSection>

        <MotionSection className="section border-t border-white/10">
          <div className="container grid gap-10 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <p className="eyebrow">The terms, up front</p>
              <h2 className="h-section">Before you ask.</h2>
            </div>
            <dl className="divide-y divide-white/10 border-y border-white/10 lg:col-span-8">
              {FAQ.map((f) => (
                <div key={f.q} className="grid gap-2 py-5 md:grid-cols-3 md:gap-6">
                  <dt className="font-display text-sm uppercase tracking-[0.12em] text-white">{f.q}</dt>
                  <dd className="text-white/70 md:col-span-2">{f.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </MotionSection>

        {!open && (
          <MotionSection id="waitlist" className="section scroll-mt-24 border-t border-white/10 bg-brand-ink">
            <div className="container max-w-3xl">
              <p className="eyebrow">Waitlist</p>
              <h2 className="h-section">Get the next opening.</h2>
              <p className="mt-4 max-w-xl text-white/70">
                Three fields. We&rsquo;ll only email you when accounts open.
              </p>
              <div className="mt-8">
                <WaitlistForm />
              </div>
            </div>
          </MotionSection>
        )}
      </main>
      <Footer />
    </>
  );
}
