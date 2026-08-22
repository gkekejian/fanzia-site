"use client";

import { useRef, useState } from "react";

type Status = "idle" | "sending" | "ok" | "error";

/**
 * Posts a form's FormData to /api/forms with `kind` and anti-spam fields
 * attached. Shared by every request/apply/quote form on the site — the
 * one backend route branches on `kind` to build the right email.
 */
export function useFormSubmit(kind: string) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const mountedAt = useRef<number>(Date.now());

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    setError(null);

    const form = e.currentTarget;
    const data = new FormData(form);
    data.set("kind", kind);
    data.set("_start", String(mountedAt.current));

    try {
      const res = await fetch("/api/forms", { method: "POST", body: data });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Something went wrong. Please try again.");
      }
      setStatus("ok");
      form.reset();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  return { status, error, onSubmit };
}
