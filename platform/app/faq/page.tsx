/**
 * Public platform FAQ. Answers are the pilot-phase rules that are actually
 * enforced in code (minimums, fees, offer expiry, approval flow) — no
 * invented promises. Update alongside lib/policies/content.ts as the
 * program matures.
 */
const FAQS: { q: string; a: string }[] = [
  {
    q: "Who can buy from Fanzia wholesale?",
    a: "Fanzia sells at wholesale only to verified businesses. Apply through our wholesale application; every application is reviewed by our team and approvals create a buyer account. Individuals and resale-for-personal-use are not eligible.",
  },
  {
    q: "How does the approval process work?",
    a: "Submit the application with your business details. Our team reviews every application — approval is manual, not automatic. We'll email you the decision. If approved, you can sign in with a magic link sent to your email; there's no password to manage.",
  },
  {
    q: "What is 'tax status: pending'?",
    a: "Approval and tax determination are separate. New accounts start as taxable until we review your resale documentation (seller's permit or resale certificate). You can upload documents from your application status page at any time; we'll email you when the determination is made.",
  },
  {
    q: "Is there a minimum order?",
    a: "Yes — $500 minimum per order. Orders under $750 carry a $25 small-order fee. First orders are capped at $5,000 while we establish the account.",
  },
  {
    q: "How do order requests work?",
    a: "Build a draft request from the catalog and submit it. That's an offer, not a sale: our team reviews it and approves, declines, or lets it expire. Approved requests become invoices you pay.",
  },
  {
    q: "How long is an offer good for?",
    a: "Order requests expire 48 hours after submission. If one lapses, you can submit a fresh request — but prices may have changed, since catalog prices are snapshotted when you submit.",
  },
  {
    q: "How do I pay?",
    a: "Approved invoices are paid online by card through Stripe. We also record manual payments (ACH/wire) where agreed. An invoice is only considered paid when cleared funds cover the total.",
  },
  {
    q: "Do you ship? How does shipping work?",
    a: "Yes — shipping is arranged per order and tracked; you'll see carrier and tracking on your invoices. Shipping fees and handling are quoted before you commit to an invoice.",
  },
  {
    q: "Can I cancel a request or get a refund?",
    a: "You can abandon a draft request at any time before submitting — it's just scratch state. Once submitted, requests can't be edited; contact us and we'll help. Paid invoices that are canceled are refunded; the details are in the Terms of Sale and Returns & Claims policy, which are still in draft pending legal review.",
  },
  {
    q: "Is pricing guaranteed?",
    a: "Catalog prices are live prices — the prices snapshotted on your submitted request are what you pay if we approve it. Catalog prices can change between visits; your submitted request is never re-priced after the fact.",
  },
  {
    q: "Who do I contact with questions?",
    a: "Use the contact form on our website, or reply to any email from us. Business hours are Tue–Sat, 11am–6pm Pacific.",
  },
];

export default function FaqPage() {
  return (
    <main className="container" style={{ maxWidth: "800px" }}>
      <div className="card">
        <h1>Wholesale FAQ</h1>
        <p style={{ color: "var(--fz-muted)" }}>
          Short answers about applying, ordering, paying, and shipping with Fanzia wholesale.
          This page covers the pilot program and may change as it grows.
        </p>
        {FAQS.map((f) => (
          <section key={f.q} style={{ marginTop: "1.75rem" }}>
            <h2 style={{ fontSize: "1.05rem", marginBottom: "0.4rem" }}>{f.q}</h2>
            <p style={{ margin: 0 }}>{f.a}</p>
          </section>
        ))}
      </div>
    </main>
  );
}
