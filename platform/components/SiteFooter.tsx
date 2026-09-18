import { SITE_FOOTER_NOTE } from "@/lib/disclaimers";

/**
 * Minimal site footer: policy links plus the wholesale-only / entity /
 * no-affiliation notice. Rendered by the root layout on every page.
 */
export function SiteFooter() {
  return (
    <footer
      style={{
        borderTop: "1px solid var(--fz-border, #e5e5e5)",
        marginTop: "3rem",
        padding: "1.5rem 1rem 2rem",
      }}
    >
      <div className="container" style={{ maxWidth: "1100px" }}>
        <nav aria-label="Policies" style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem 1.25rem", marginBottom: "1rem" }}>
          <a href="/terms">Terms of Sale</a>
          <a href="/privacy">Privacy Policy</a>
          <a href="/shipping">Shipping Policy</a>
          <a href="/returns">Returns &amp; Claims</a>
          <a href="/import-policy">Import &amp; Edition Policy</a>
        </nav>
        <p style={{ color: "var(--fz-muted)", fontSize: "0.85rem", margin: 0 }}>
          {SITE_FOOTER_NOTE} Wholesale only — approved accounts.
        </p>
      </div>
    </footer>
  );
}
