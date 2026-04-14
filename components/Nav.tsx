"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "#services", label: "Services" },
  { href: "#how-we-work", label: "Process" },
  { href: "#results", label: "Results" },
  { href: "#retail", label: "Retail" },
  { href: "#about", label: "About" },
  { href: "#contact", label: "Contact" },
];

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all ${
        scrolled
          ? "bg-black/80 backdrop-blur-md border-b border-white/5"
          : "bg-transparent"
      }`}
    >
      <div className="container flex h-20 items-center justify-between text-white">
        <a
          href="#top"
          className="flex items-center gap-3"
          aria-label="Fanzia home"
        >
          <Image
            src="/brand/logo-white.png"
            alt="Fanzia"
            width={140}
            height={36}
            className="h-8 w-auto md:h-9"
            priority
          />
        </a>

        <nav className="hidden items-center gap-8 lg:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="font-display text-xs uppercase tracking-[0.2em] text-white/70 transition hover:text-brand-red"
            >
              {l.label}
            </a>
          ))}
          <a href="#contact" className="btn-primary !py-3 !px-5 text-sm">
            Free Consultation
          </a>
        </nav>

        <button
          type="button"
          aria-label="Toggle menu"
          aria-expanded={open}
          className="lg:hidden"
          onClick={() => setOpen((v) => !v)}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            className="h-7 w-7"
          >
            {open ? (
              <path strokeLinecap="square" d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="square" d="M4 7h16M4 12h16M4 17h16" />
            )}
          </svg>
        </button>
      </div>

      {open && (
        <div className="border-t border-white/10 bg-black lg:hidden">
          <nav className="container flex flex-col gap-1 py-4">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-none border-b border-white/5 px-2 py-3 font-display text-sm uppercase tracking-[0.2em] text-white/90 hover:text-brand-red"
              >
                {l.label}
              </a>
            ))}
            <a
              href="#contact"
              onClick={() => setOpen(false)}
              className="btn-primary mt-3 w-full"
            >
              Free Consultation
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}
