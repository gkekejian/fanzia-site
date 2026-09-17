"use client";

import { useState, type FormEvent } from "react";

export default function AdminTotpVerifyPage() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const token = new FormData(e.currentTarget).get("token");
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/totp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Incorrect code.");
        setSubmitting(false);
        return;
      }
      window.location.href = "/admin/applications";
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <main className="container">
      <div className="card">
        <h1>Enter your authenticator code</h1>
        <p>Enter the 6-digit code from your authenticator app, or a recovery code.</p>
        <form onSubmit={onSubmit}>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <label htmlFor="token">Code</label>
          <input
            id="token"
            name="token"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            autoFocus
          />
          <button type="submit" className="btn" disabled={submitting} style={{ marginTop: "1rem" }}>
            {submitting ? "Verifying…" : "Verify"}
          </button>
        </form>
      </div>
    </main>
  );
}
