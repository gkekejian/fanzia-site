"use client";

import { useState } from "react";
import MotionSection from "./MotionSection";

type Status = "idle" | "sending" | "ok" | "error";

export default function Contact() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    setError(null);

    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

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

  return (
    <MotionSection id="contact" className="section bg-brand-primary text-white">
      <div className="container grid gap-12 lg:grid-cols-2">
        <div>
          <p className="eyebrow !text-brand-accent">Contact</p>
          <h2 className="mt-3 text-3xl font-bold md:text-4xl lg:text-5xl">
            Tell us what you&rsquo;re building. We&rsquo;ll help you get it done.
          </h2>
          <p className="mt-6 text-lg text-white/80">
            A free 30-minute consultation. No pitch deck. Just a conversation
            about where AI and automation can move your business.
          </p>

          <div className="mt-10 space-y-4 text-sm text-white/80">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-white/50">
                Email
              </div>
              <a
                href="mailto:hello@fanzia.io"
                className="text-base font-semibold text-white hover:text-brand-accent"
              >
                hello@fanzia.io
              </a>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-white/50">
                Phone
              </div>
              <span className="text-base font-semibold text-white">
                (818) 555-0100
              </span>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-white/50">
                Location
              </div>
              <span className="text-base font-semibold text-white">
                Glendale &amp; Los Angeles, CA
              </span>
            </div>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-2xl bg-white p-6 text-brand-text shadow-xl md:p-8"
          noValidate
        >
          <div className="grid gap-5">
            <Field label="Name" name="name" required autoComplete="name" />
            <Field
              label="Email"
              name="email"
              type="email"
              required
              autoComplete="email"
            />
            <Field label="Phone" name="phone" type="tel" autoComplete="tel" />
            <label className="block">
              <span className="text-sm font-semibold text-brand-primary">
                Message
              </span>
              <textarea
                name="message"
                required
                rows={5}
                className="mt-1.5 w-full rounded-md border border-black/10 bg-white px-3 py-2.5 text-base text-brand-text shadow-sm focus:border-brand-accent focus:outline-none focus:ring-2 focus:ring-brand-accent/30"
                placeholder="Tell us about your business and what you want to build."
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={status === "sending"}
            className="btn-primary mt-6 w-full disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === "sending" ? "Sending..." : "Submit"}
          </button>

          <div className="mt-4 min-h-[1.25rem] text-sm" aria-live="polite">
            {status === "ok" && (
              <span className="text-green-700">
                Thanks. We&rsquo;ll be in touch within one business day.
              </span>
            )}
            {status === "error" && (
              <span className="text-brand-accent">
                {error || "Could not send. Email hello@fanzia.io directly."}
              </span>
            )}
          </div>
        </form>
      </div>
    </MotionSection>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  autoComplete,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-brand-primary">
        {label}
        {required && <span className="ml-0.5 text-brand-accent">*</span>}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        className="mt-1.5 w-full rounded-md border border-black/10 bg-white px-3 py-2.5 text-base text-brand-text shadow-sm focus:border-brand-accent focus:outline-none focus:ring-2 focus:ring-brand-accent/30"
      />
    </label>
  );
}
