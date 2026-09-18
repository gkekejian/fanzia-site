"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { linkErrorMessage } from "@/lib/auth/linkErrors";

function LoginForm() {
  const searchParams = useSearchParams();
  const linkError = linkErrorMessage(searchParams.get("error"));
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const email = new FormData(e.currentTarget).get("email");
    setSubmitting(true);
    try {
      const res = await fetch("/api/buyer/auth/magic-link/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Something went wrong.");
        setSubmitting(false);
        return;
      }
      setSent(true);
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <main className="container">
      <div className="card">
        <h1>Buyer sign-in</h1>
        <p>Sign in with the email address on your approved Fanzia wholesale account.</p>
        {sent ? (
          <p role="status">
            If that email is on an approved account, a sign-in link has been sent. Check your
            inbox — the link expires in 15 minutes and can only be used once.
          </p>
        ) : (
          <form onSubmit={onSubmit}>
            {linkError && (
              <p className="field-error" role="alert">
                {linkError}
              </p>
            )}
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required autoComplete="email" autoFocus />
            <button type="submit" className="btn" disabled={submitting} style={{ marginTop: "1rem" }}>
              {submitting ? "Sending…" : "Send sign-in link"}
            </button>
            <p style={{ color: "var(--fz-muted)", fontSize: "0.85rem", marginTop: "0.5rem" }}>
              The link expires in 15 minutes and can only be used once.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}

export default function MemberLoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
