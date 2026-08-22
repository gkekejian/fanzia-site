"use client";

import { useEffect, useState } from "react";

const CATALOG_PATH = "/fanzia-wholesale-catalog.pdf";

// {{TODO: catalog PDF}} — once approved-account catalog PDF exists at
// public/fanzia-wholesale-catalog.pdf, this button enables automatically.
export default function CatalogDownload() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(CATALOG_PATH, { method: "HEAD" })
      .then((res) => {
        if (!cancelled) setAvailable(res.ok);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (available) {
    return (
      <a href={CATALOG_PATH} className="btn-primary" download>
        Download Catalog
      </a>
    );
  }

  return (
    <button type="button" disabled className="btn-primary cursor-not-allowed opacity-50">
      Catalog available on approval
    </button>
  );
}
