"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Minimal cookie consent banner. Stores the user's choice in
 * localStorage under `fanzia-cookie-consent` as either "accepted" or
 * "denied". No tracking cookies are set unless and until consent is
 * explicitly given.
 *
 * Any analytics/marketing code you add later should check
 * localStorage.getItem("fanzia-cookie-consent") === "accepted" before
 * running.
 */
const STORAGE_KEY = "fanzia-cookie-consent";
type Choice = "accepted" | "denied";

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const firstFocusable = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try {
      const existing = localStorage.getItem(STORAGE_KEY);
      if (existing !== "accepted" && existing !== "denied") {
        // Defer show to next tick so we don't flash during hydration
        const id = setTimeout(() => setVisible(true), 600);
        return () => clearTimeout(id);
      }
    } catch {
      // localStorage unavailable; still show the banner but choice
      // won't persist.
      setVisible(true);
    }
  }, []);

  useEffect(() => {
    if (visible) firstFocusable.current?.focus();
  }, [visible]);

  const save = (choice: Choice) => {
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      /* no-op */
    }
    setVisible(false);
    // Fire a custom event so any listeners (future analytics init) react.
    window.dispatchEvent(
      new CustomEvent("fanzia:consent", { detail: choice }),
    );
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-title"
      aria-describedby="cookie-desc"
      className="fixed inset-x-0 bottom-0 z-[60] p-4 md:p-6"
    >
      <div className="mx-auto max-w-5xl border-2 border-brand-red bg-black p-5 text-white shadow-[8px_8px_0_0_#f13737] md:flex md:items-center md:gap-8 md:p-6">
        <div className="flex-1">
          <p
            id="cookie-title"
            className="font-display text-xs uppercase tracking-[0.3em] text-brand-red"
          >
            Cookies
          </p>
          <p id="cookie-desc" className="mt-2 text-sm text-white/85">
            We use a minimal set of cookies to make this site work and to
            understand aggregate traffic. We do not sell your data. See our{" "}
            <a
              href="/privacy"
              className="underline decoration-brand-red decoration-2 underline-offset-2 hover:text-brand-red"
            >
              Privacy Policy
            </a>
            .
          </p>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row md:mt-0">
          <button
            ref={firstFocusable}
            type="button"
            onClick={() => save("accepted")}
            className="inline-flex items-center justify-center bg-brand-red px-5 py-3 font-display text-xs uppercase tracking-[0.22em] text-white transition hover:bg-brand-rose focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Accept
          </button>
          <button
            type="button"
            onClick={() => save("denied")}
            className="inline-flex items-center justify-center border border-white/30 bg-transparent px-5 py-3 font-display text-xs uppercase tracking-[0.22em] text-white/85 transition hover:border-white hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}
