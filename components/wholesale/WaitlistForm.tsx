"use client";

import { useRef, useState, type FormEvent } from "react";

const CHANNELS = [
  "Vending operator",
  "Whatnot / TikTok live seller",
  "Card or hobby shop",
  "Asian specialty retail",
  "Event / show seller",
  "Other",
];

const VOLUMES = ["Under $1,000 / month", "$1,000 to $5,000 / month", "$5,000 to $20,000 / month", "$20,000+ / month"];

type Status = "idle" | "sending" | "ok" | "error";

/**
 * Three required fields, one tap. Replaces the 18-field application as the
 * FIRST step while the portal is paused: capture demand now, qualify later
 * in a batch. Submissions land in the platform inbox tagged "waitlist"
 * (via /api/contact), not in a personal mailbox.
 */
export default function WaitlistForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const mountedAt = useRef(Date.now());

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setStatus("sending");
    setError(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: "waitlist",
          name: String(data.get("business") ?? ""),
          email: String(data.get("email") ?? ""),
          channel: String(data.get("channel") ?? ""),
          volume: String(data.get("volume") ?? ""),
          website: String(data.get("website") ?? ""),
          _start: mountedAt.current,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Something went wrong. Please try again.");
      }
      setStatus("ok");
      form.reset();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  if (status === "ok") {
    return (
      <div role="status" className="border border-white/15 bg-black p-6 md:p-8">
        <p className="font-display text-2xl uppercase text-white">You&rsquo;re on the list.</p>
        <p className="mt-3 text-white/70">
          We&rsquo;ll email you when the next batch of wholesale accounts opens. No calls, no follow-up forms until then.
        </p>
      </div>
    );
  }

  const field =
    "mt-2 block w-full min-h-[48px] rounded-none border border-white/20 bg-black px-4 text-base text-white placeholder:text-white/35 focus:border-brand-red focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-red";
  const label = "font-display text-xs uppercase tracking-[0.22em] text-white/70";

  return (
    <form onSubmit={onSubmit} className="grid gap-5 border border-white/15 bg-black p-6 md:grid-cols-2 md:p-8" noValidate={false}>
      <label className="block md:col-span-1">
        <span className={label}>Business name</span>
        <input name="business" required maxLength={200} autoComplete="organization" className={field} placeholder="Acme Cards LLC" />
      </label>
      <label className="block md:col-span-1">
        <span className={label}>Work email</span>
        <input name="email" type="email" required maxLength={320} autoComplete="email" inputMode="email" className={field} placeholder="you@business.com" />
      </label>
      <label className="block">
        <span className={label}>How you sell</span>
        <select name="channel" required defaultValue="" className={field}>
          <option value="" disabled>
            Select one
          </option>
          {CHANNELS.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={label}>
          Monthly buying <span className="normal-case tracking-normal text-white/40">(optional)</span>
        </span>
        <select name="volume" defaultValue="" className={field}>
          <option value="">Prefer not to say</option>
          {VOLUMES.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      {/* Honeypot: hidden from people, filled by bots. */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="md:col-span-2">
        <button type="submit" disabled={status === "sending"} className="btn-primary w-full min-h-[52px] disabled:cursor-not-allowed disabled:opacity-60">
          {status === "sending" ? "Adding you…" : "Join the wholesale waitlist"}
        </button>
        <p className="mt-3 text-xs text-white/50">
          Business buyers only. You&rsquo;ll need a valid resale certificate to be approved.
        </p>
        <p aria-live="polite" className="mt-2 text-sm text-brand-red">
          {status === "error" ? error : ""}
        </p>
      </div>
    </form>
  );
}
