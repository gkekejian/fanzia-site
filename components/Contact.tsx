"use client";

import { useRef, useState } from "react";
import MotionSection from "./MotionSection";

type Status = "idle" | "sending" | "ok" | "error";

export default function Contact() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const mountedAt = useRef<number>(Date.now());

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    setError(null);

    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries()) as Record<
      string,
      string
    >;
    const payload = { ...data, _start: mountedAt.current };

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
    <MotionSection id="contact" className="section bg-black text-white">
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-50" aria-hidden />
      <div className="container relative">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-6">
            <p className="eyebrow">Let&rsquo;s Talk</p>
            <h2 className="h-section">
              Tell us what you&rsquo;re building.
              <br />
              <span className="text-brand-red">We&rsquo;ll help you get it done.</span>
            </h2>
            <p className="mt-6 max-w-lg text-lg text-white/70">
              A free 30-minute consultation. No pitch deck, no slide theatre.
              Just a conversation, operator to operator, about where AI and
              automation can move your business.
            </p>

            <div className="mt-10 space-y-5">
              <ContactFact label="Email" value="contact@fanzia.io" href="mailto:contact@fanzia.io" />
              <ContactFact label="Phone" value="(818) 796-3388" href="tel:+18187963388" />
              <ContactFact label="Location" value="Glendale & Los Angeles, CA" />
            </div>
          </div>

          <form
            onSubmit={onSubmit}
            noValidate
            className="relative lg:col-span-6"
          >
            <div className="absolute -left-3 -top-3 h-full w-full border-2 border-brand-red" aria-hidden />
            <div className="relative border-2 border-white bg-black p-6 md:p-10">
              <div className="mb-6 flex items-center justify-between">
                <span className="font-display text-xs uppercase tracking-[0.3em] text-brand-red">
                  Transmission / 001
                </span>
                <span className="font-display text-xs uppercase tracking-[0.3em] text-white/40">
                  secure
                </span>
              </div>

              <div className="grid gap-5">
                {/* Honeypot: invisible to humans, irresistible to bots.
                    Must not be tabbable or announced to screen readers. */}
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: "-10000px",
                    top: "auto",
                    width: 1,
                    height: 1,
                    overflow: "hidden",
                  }}
                >
                  <label>
                    Website (leave blank)
                    <input
                      type="text"
                      name="website"
                      tabIndex={-1}
                      autoComplete="off"
                    />
                  </label>
                </div>

                <Field label="Name" name="name" required autoComplete="name" />
                <Field label="Email" name="email" type="email" required autoComplete="email" />
                <Field label="Phone" name="phone" type="tel" autoComplete="tel" />
                <label className="block">
                  <span className="font-display text-xs uppercase tracking-[0.22em] text-white/70">
                    Message
                  </span>
                  <textarea
                    name="message"
                    required
                    rows={5}
                    className="mt-2 w-full rounded-none border border-white/20 bg-black px-4 py-3 text-base text-white placeholder:text-white/30 focus:border-brand-red focus:outline-none"
                    placeholder="Tell us about your business and what you want to build."
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={status === "sending"}
                className="btn-primary mt-8 w-full disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === "sending" ? "Sending..." : "Submit Transmission"}
              </button>

              <div className="mt-4 min-h-[1.25rem] text-sm" aria-live="polite">
                {status === "ok" && (
                  <span className="text-brand-red">
                    Received. We&rsquo;ll be in touch within one business day.
                  </span>
                )}
                {status === "error" && (
                  <span className="text-brand-red">
                    {error || "Could not send. Email contact@fanzia.io directly."}
                  </span>
                )}
              </div>
            </div>
          </form>
        </div>
      </div>
    </MotionSection>
  );
}

function ContactFact({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  const inner = (
    <>
      <span className="block font-display text-[10px] uppercase tracking-[0.3em] text-brand-red">
        {label}
      </span>
      <span className="mt-1 block font-display text-2xl uppercase tracking-tight text-white md:text-3xl">
        {value}
      </span>
    </>
  );
  return (
    <div className="border-b border-white/10 pb-5">
      {href ? (
        <a href={href} className="block hover:text-brand-red">
          {inner}
        </a>
      ) : (
        inner
      )}
    </div>
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
      <span className="font-display text-xs uppercase tracking-[0.22em] text-white/70">
        {label}
        {required && <span className="ml-1 text-brand-red">*</span>}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        className="mt-2 w-full rounded-none border border-white/20 bg-black px-4 py-3 text-base text-white placeholder:text-white/30 focus:border-brand-red focus:outline-none"
      />
    </label>
  );
}
