"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const PORTAL = process.env.NEXT_PUBLIC_PORTAL_URL ?? "https://app.fanzia.io";

// Five destinations, one primary action. The old header had 7 links plus
// "Wholesale Application", "Customer Portal", "Apply for Wholesale", and
// "Sign In" (four ways into two places, two of them pointing at the same
// closed /apply page). /catalog is gone: it now redirects to the portal.
const LINKS = [
  { href: "/store", label: "Store" },
  { href: "/products", label: "Products" },
  { href: "/wholesale", label: "Wholesale" },
  { href: "/supply", label: "Supply" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

const linkCls =
  "font-display text-xs uppercase tracking-[0.2em] transition hover:text-brand-red focus-visible:text-brand-red focus-visible:outline-none";

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the mobile menu on navigation and on Escape.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors ${
        scrolled || open ? "border-b border-white/5 bg-black/90 backdrop-blur-md" : "bg-transparent"
      }`}
    >
      <div className="container flex h-20 items-center justify-between gap-6 text-white">
        <Link href="/" className="flex shrink-0 items-center" aria-label="Fanzia home">
          <Image src="/brand/logo-white.png" alt="Fanzia" width={200} height={52} className="h-10 w-auto md:h-12" priority />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-7 lg:flex">
          {LINKS.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`${linkCls} ${active ? "text-white" : "text-white/70"}`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-5 lg:flex">
          <a href={`${PORTAL}/member/login`} className={`${linkCls} text-white/70`}>
            Buyer sign in
          </a>
          <Link href="/wholesale" className="btn-primary !px-5 !py-3 text-sm">
            Buy wholesale
          </Link>
        </div>

        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-menu"
          className="-mr-2 flex h-12 w-12 items-center justify-center lg:hidden"
          onClick={() => setOpen((v) => !v)}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="h-7 w-7" aria-hidden="true">
            {open ? <path strokeLinecap="square" d="M6 18L18 6M6 6l12 12" /> : <path strokeLinecap="square" d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>

      {open && (
        <div id="mobile-menu" className="border-t border-white/10 bg-black lg:hidden">
          <nav aria-label="Mobile" className="container flex flex-col py-4">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={pathname === l.href ? "page" : undefined}
                className="border-b border-white/5 px-2 py-4 font-display text-sm uppercase tracking-[0.2em] text-white/90 hover:text-brand-red"
              >
                {l.label}
              </Link>
            ))}
            <Link href="/wholesale" className="btn-primary mt-4 w-full text-center">
              Buy wholesale
            </Link>
            <a
              href={`${PORTAL}/member/login`}
              className="mt-2 px-2 py-4 text-center font-display text-sm uppercase tracking-[0.2em] text-white/80 hover:text-brand-red"
            >
              Buyer sign in
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}
