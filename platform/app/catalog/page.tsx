import { getPublicCatalog } from "@/lib/catalog/queries";

// The catalog changes at runtime (imports publish new products and prices),
// so this page is never statically prerendered.
export const dynamic = "force-dynamic";

/**
 * Server component calling getPublicCatalog() directly — the same
 * PublicProductDTO-typed function the public /api/catalog route uses.
 * Neither path has any way to read price/availability (test gate #1).
 */
export default async function PublicCatalogPage() {
  const products = await getPublicCatalog();

  return (
    <main className="container" style={{ maxWidth: "1100px" }}>
      <h1>Catalog</h1>
      <p>
        Wholesale pricing and availability are shown to approved buyers only.{" "}
        <a href="/apply">Apply for a wholesale account</a> or <a href="/member/login">sign in</a>.
      </p>
      {products.length === 0 && <p>No products are listed yet.</p>}
      {products.length > 0 && (
        <table>
          <caption className="visually-hidden">Public product catalog</caption>
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Edition / language</th>
              <th scope="col">Origin</th>
              <th scope="col">Condition</th>
              <th scope="col">Packs / unit</th>
              <th scope="col">Release status</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.sku}>
                <td>
                  <strong>{p.name}</strong>
                  <br />
                  <span style={{ color: "var(--fz-muted)", fontSize: "0.85rem" }}>{p.sku}</span>
                </td>
                <td>{p.editionLanguage}</td>
                <td>{p.origin}</td>
                <td>{p.condition === "sealed" ? "Sealed" : "No shrink"}</td>
                <td>
                  {p.packsPerUnit}
                  {p.cardsPerPack ? ` × ${p.cardsPerPack} cards/pack` : ""}
                </td>
                <td>{p.releaseStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
