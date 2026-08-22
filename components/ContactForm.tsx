"use client";

import { useRef, useState } from "react";
import {
  TextField,
  TextAreaField,
  Honeypot,
  SubmitButton,
  StatusBanner,
} from "@/components/forms/fields";

type Status = "idle" | "sending" | "ok" | "error";

export default function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const mountedAt = useRef<number>(Date.now());

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    setError(null);

    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
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
    <form onSubmit={onSubmit} noValidate className="relative">
      <div className="absolute -left-3 -top-3 h-full w-full border-2 border-brand-red" aria-hidden />
      <div className="relative border-2 border-white bg-black p-6 md:p-10">
        <Honeypot />
        <div className="grid gap-5">
          <TextField label="Name" name="name" required autoComplete="name" />
          <TextField label="Email" name="email" type="email" required autoComplete="email" />
          <TextField label="Phone" name="phone" type="tel" autoComplete="tel" />
          <TextAreaField label="Message" name="message" required rows={5} placeholder="How can we help?" />
        </div>
        <SubmitButton pending={status === "sending"}>Send Message</SubmitButton>
        <StatusBanner
          status={status}
          successMessage="Received. We'll be in touch within one business day."
          errorMessage={error}
        />
      </div>
    </form>
  );
}
