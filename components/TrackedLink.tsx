"use client";

import { track } from "@vercel/analytics";
import type { AnchorHTMLAttributes, ReactNode } from "react";

/**
 * A plain link that records a named conversion event in Vercel Web
 * Analytics (e.g. "apply_clicked"). Page views are free on every plan;
 * custom events like this one are recorded on Vercel Pro and silently
 * ignored otherwise, so it is always safe to use.
 */
export default function TrackedLink({
  event,
  props,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { event: string; props?: Record<string, string>; children: ReactNode }) {
  return (
    <a
      {...rest}
      onClick={(e) => {
        try {
          track(event, props);
        } catch {
          // Analytics must never block navigation.
        }
        rest.onClick?.(e);
      }}
    >
      {children}
    </a>
  );
}
