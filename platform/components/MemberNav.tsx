"use client";

import { usePathname } from "next/navigation";
import { useOrderRules } from "./member/OrderRulesContext";

const ALLOCATION_LINKS = [
  { href: "/member/offers", label: "Offers" },
  { href: "/member/catalog", label: "Catalog" },
  { href: "/member/wants", label: "My wants" },
  { href: "/member/invoices", label: "Invoices" },
  { href: "/member/payment", label: "Card" },
];

const LINKS = [
  { href: "/member/catalog", label: "Catalog" },
  { href: "/member/draft-request", label: "Draft request" },
  { href: "/member/order-requests", label: "Order requests" },
  { href: "/member/invoices", label: "Invoices" },
];

export function MemberNav({ contactName }: { contactName: string }) {
  const pathname = usePathname();
  const { allocationMode } = useOrderRules();
  const links = allocationMode ? ALLOCATION_LINKS : [...LINKS, { href: "/member/payment", label: "Card" }];

  async function logout() {
    await fetch("/api/buyer/auth/logout", { method: "POST" });
    window.location.href = "/member/login";
  }

  return (
    <nav className="admin-nav member-nav" aria-label="Buyer navigation">
      {links.map((l) => {
        const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <a key={l.href} href={l.href} aria-current={active ? "page" : undefined} className={active ? "nav-active" : ""}>
            {l.label}
          </a>
        );
      })}
      <span style={{ marginLeft: "auto", color: "var(--fz-muted)" }}>{contactName}</span>
      <button type="button" className="btn btn-secondary" onClick={logout} style={{ padding: "0.3rem 0.8rem" }}>
        Log out
      </button>
    </nav>
  );
}
