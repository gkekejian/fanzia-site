"use client";

import { useEffect, useState, type FormEvent } from "react";

export function TotpSetup() {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/auth/totp/setup", { method: "POST" })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Could not start TOTP setup.");
        setQrDataUrl(body.qrDataUrl);
        setSecret(body.secret);
      })
      .catch((err) => setError(err.message));
  }, []);

  async function onConfirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const token = new FormData(e.currentTarget).get("token");
    setSubmitting(true);
    const res = await fetch("/api/auth/totp/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      setError(body.error ?? "Incorrect code.");
      return;
    }
    setRecoveryCodes(body.recoveryCodes);
  }

  if (recoveryCodes) {
    return (
      <main className="container">
        <div className="card">
          <h1>Save your recovery codes</h1>
          <p>
            Two-factor authentication is now active. These recovery codes are shown <strong>once</strong> — store
            them somewhere safe. Each one can be used a single time if you lose access to your authenticator.
          </p>
          <pre className="card" style={{ background: "#fafafa" }}>
            {recoveryCodes.join("\n")}
          </pre>
          <a className="btn" href="/admin/applications">
            Continue to the admin console
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="container">
      <div className="card">
        <h1>Set up two-factor authentication</h1>
        <p>Scan this code with an authenticator app (Google Authenticator, 1Password, Authy, etc.).</p>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {qrDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrDataUrl} alt="Scan this QR code with your authenticator app to set up two-factor authentication" width={220} height={220} />
        )}
        {secret && (
          <p>
            Can&apos;t scan? Enter this key manually: <code>{secret}</code>
          </p>
        )}
        <form onSubmit={onConfirm}>
          <label htmlFor="token">Enter the 6-digit code to confirm</label>
          <input id="token" name="token" type="text" inputMode="numeric" required autoFocus />
          <button type="submit" className="btn" disabled={submitting} style={{ marginTop: "1rem" }}>
            {submitting ? "Confirming…" : "Confirm"}
          </button>
        </form>
      </div>
    </main>
  );
}
