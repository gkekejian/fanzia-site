"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AgentChatPanel } from "./admin/AgentChatPanel";

type NavState = {
  unreadCount: number;
  todayCount: number;
  todayUrgent: number;
  modules: Record<string, boolean>;
  orderingPaused: boolean;
};

type Link = { href: string; label: string; module?: string };

/**
 * Grouped admin navigation. Before: 16 flat links in one scrolling row.
 * Now: Today and Analytics up front, everything else in five menus, and
 * modules switched off in Settings disappear. Menus are native <details>
 * so they work without JS and with the keyboard.
 */
const GROUPS: { label: string; links: Link[] }[] = [
  {
    label: "Orders",
    links: [
      { href: "/admin/order-requests", label: "Order requests" },
      { href: "/admin/invoices", label: "Invoices" },
      { href: "/admin/allocation-rounds", label: "Supplier rounds" },
      { href: "/admin/po-packs", label: "PO packs" },
    ],
  },
  {
    label: "Buyers",
    links: [
      { href: "/admin/applications", label: "Applications" },
      { href: "/admin/accounts", label: "Accounts" },
      { href: "/admin/inbox", label: "Inbox & waitlist" },
    ],
  },
  {
    label: "Catalog",
    links: [
      { href: "/admin/products", label: "Products & case sizes" },
      { href: "/admin/catalog-imports", label: "Price list imports" },
      { href: "/admin/price-intel", label: "Price intelligence", module: "module_price_intel" },
      { href: "/admin/nayax", label: "Vending", module: "module_vending" },
    ],
  },
  {
    label: "Admin",
    links: [
      { href: "/admin/settings", label: "Settings" },
      { href: "/admin/system-status", label: "System status" },
      { href: "/admin/notifications", label: "Notifications" },
      { href: "/admin/accounting", label: "Cashbook", module: "module_accounting" },
      { href: "/admin/users", label: "Users" },
      { href: "/admin/security", label: "Security" },
      { href: "/admin/api-keys", label: "API keys" },
      { href: "/admin/agent-proposals", label: "AI proposals" },
    ],
  },
];

export function AdminNav({ userName }: { userName: string }) {
  const [state, setState] = useState<NavState | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/admin/nav-state")
      .then(async (res) => (res.ok ? setState(await res.json()) : null))
      .catch(() => {
        // Decorative counts only: a failed fetch must never break navigation.
      });
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/admin/login";
  }

  // Until state loads, show every link (never hide something the owner needs).
  const visible = (l: Link) => !l.module || !state || state.modules[l.module] !== false;
  const path = usePathname() ?? "";

  return (
    <header className="admin-header">
      <nav className="admin-nav" aria-label="Admin navigation">
        <a href="/admin" className="admin-brand" aria-current={path === "/admin" ? "page" : undefined}>
          Fanzia
        </a>
        <a href="/admin" className="admin-primary-link" aria-current={path === "/admin" ? "page" : undefined}>
          Today
          {state && state.todayCount > 0 && (
            <span className={`count-pill ${state.todayUrgent > 0 ? "count-pill-urgent" : ""}`} aria-label={`${state.todayCount} waiting`}>
              {state.todayCount > 99 ? "99+" : state.todayCount}
            </span>
          )}
        </a>
        <a href="/admin/analytics" className="admin-primary-link" aria-current={path.startsWith("/admin/analytics") ? "page" : undefined}>
          Analytics
        </a>

        <button
          type="button"
          className="admin-menu-toggle btn btn-secondary btn-compact"
          aria-expanded={open}
          aria-controls="admin-menu"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close" : "Menu"}
        </button>

        <div id="admin-menu" className={`admin-menu ${open ? "admin-menu-open" : ""}`}>
          {GROUPS.map((g) => {
            const links = g.links.filter(visible);
            if (links.length === 0) return null;
            const active = links.some((l) => path.startsWith(l.href));
            return (
              <details key={g.label} className="admin-group" open={open ? true : undefined}>
                <summary className={active ? "admin-group-active" : undefined}>{g.label}</summary>
                <ul>
                  {links.map((l) => (
                    <li key={l.href}>
                      <a href={l.href} aria-current={path.startsWith(l.href) ? "page" : undefined}>
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </div>

        <div className="admin-nav-end">
          <a href="/admin/notifications" className="admin-bell" aria-label={`Notifications${state?.unreadCount ? `, ${state.unreadCount} unread` : ""}`}>
            <span aria-hidden="true">🔔</span>
            {state && state.unreadCount > 0 && <span className="count-pill">{state.unreadCount > 99 ? "99+" : state.unreadCount}</span>}
          </a>
          <span className="admin-user">{userName}</span>
          <button type="button" className="btn btn-secondary btn-compact" onClick={logout}>
            Log out
          </button>
        </div>
        {state?.modules.module_ai_operator === true && <AgentChatPanel />}
      </nav>
      {state?.orderingPaused && (
        <div className="notice-banner" role="status">
          Ordering is paused. Buyers can browse but not submit. <a href="/admin/settings#Ordering">Change in Settings</a>
        </div>
      )}
    </header>
  );
}
