"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (widgetId: string) => void;
    };
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * Cloudflare Turnstile widget (explicit render). Calls onToken with the
 * client token when the challenge completes; onExpire/onError clear it so
 * the form can't submit with a stale token.
 *
 * Fail-open: when NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset, renders nothing
 * and the form submits without a token — the server allows it (see
 * lib/turnstile.ts). This keeps local dev and pre-key deploys working.
 */
export function TurnstileWidget({
  onToken,
  onExpire,
}: {
  onToken: (token: string) => void;
  onExpire?: () => void;
}) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const containerRef = useRef<HTMLDivElement>(null);
  const callbacksRef = useRef({ onToken, onExpire });
  callbacksRef.current = { onToken, onExpire };

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;
    let widgetId: string | null = null;
    let cancelled = false;

    const render = () => {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      widgetId = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token: string) => callbacksRef.current.onToken(token),
        "expired-callback": () => callbacksRef.current.onExpire?.(),
        "error-callback": () => callbacksRef.current.onExpire?.(),
      });
    };

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      if (window.turnstile) render();
      else existing.addEventListener("load", render, { once: true });
    } else {
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.addEventListener("load", render, { once: true });
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) {
        try {
          window.turnstile.remove(widgetId);
        } catch {
          /* widget already gone */
        }
      }
    };
  }, [siteKey]);

  if (!siteKey) return null;
  return <div ref={containerRef} style={{ marginTop: "1rem" }} />;
}
