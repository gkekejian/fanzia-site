"use client";

import { useEffect, useState, type FormEvent } from "react";
import { RecoveryCodes } from "./RecoveryCodes";

type Status = { totpEnabled: boolean; unusedRecoveryCodes: number };

/**
 * Self-service security console for the signed-in owner:
 * - see 2FA status and how many unused recovery codes remain
 * - generate a fresh set of recovery codes (requires a current TOTP code;
 *   the new set is shown exactly once, with copy/download)
 * - re-enroll the authenticator app (the setup flow rotates codes too)
 */
export function SecurityConsole() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    const res = await fetch("/api/auth/totp/recovery-codes");
    if (res.ok) setStatus(await res.json());
    else setError("Could not load security status.");
  }

  useEffect(() => {
    load();
  }, []);

  async function onRegenerate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const token = new FormData(e.currentTarget).get("token");
    if (!window.confirm("Generate new recovery codes? Your current codes will stop working immediately.")) return;
    setSubmitting(true);
    const res = await fetch("/api/auth/totp/recovery-codes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      setError(body.error ?? "Could not generate new codes.");
      return;
    }
    setNewCodes(body.recoveryCodes);
    (e.target as HTMLFormElement).reset();
    load();
  }

  return (
    <main className="container" style={{ maxWidth: "760px" }}>
      <h1>Security</h1>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {!status && !error && <p aria-live="polite">Loading…</p>}
      {status && (
        <>
          <section className="card">
            <h2>Two-factor authentication</h2>
            <p>
              Status: <strong>{status.totpEnabled ? "Enabled" : "Not set up"}</strong>
            </p>
            {status.totpEnabled && (
              <p style={{ color: "var(--fz-muted)", fontSize: "0.9rem" }}>
                Unused recovery codes remaining: <strong>{status.unusedRecoveryCodes}</strong> of 10. Each code works
                once, at the sign-in code prompt, if you lose your authenticator.
              </p>
            )}
            <a className="btn btn-secondary" href="/admin/totp-setup" style={{ marginTop: "0.5rem" }}>
              {status.totpEnabled ? "Set up a new authenticator app" : "Set up two-factor authentication"}
            </a>
          </section>

          {status.totpEnabled && !newCodes && (
            <section className="card">
              <h2>New recovery codes</h2>
              <p style={{ color: "var(--fz-muted)", fontSize: "0.9rem" }}>
                Lost your saved codes? Generate a fresh set. Enter a current 6-digit code from your authenticator to
                confirm it&apos;s you — your old codes stop working the moment the new ones are issued.
              </p>
              <form onSubmit={onRegenerate}>
                <label htmlFor="regen-token">6-digit code from your authenticator</label>
                <input id="regen-token" name="token" type="text" inputMode="numeric" required autoComplete="one-time-code" />
                <button type="submit" className="btn" disabled={submitting} style={{ marginTop: "1rem" }}>
                  {submitting ? "Generating…" : "Generate new recovery codes"}
                </button>
              </form>
            </section>
          )}

          {newCodes && (
            <section className="card">
              <h2>Save your new recovery codes</h2>
              <p>
                These are shown <strong>once</strong> — copy or download them now. Your previous codes no longer work.
              </p>
              <RecoveryCodes codes={newCodes} />
              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginTop: "1rem" }}
                onClick={() => setNewCodes(null)}
              >
                Done
              </button>
            </section>
          )}
        </>
      )}
    </main>
  );
}
