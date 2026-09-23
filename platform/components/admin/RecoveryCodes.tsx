"use client";

import { useState } from "react";

/**
 * Displays one-time recovery codes (shown exactly once by the server) with
 * copy-to-clipboard and download (.txt / .csv) options so the owner can
 * actually save them somewhere safe.
 */
export function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API can be unavailable (permissions, insecure context) —
      // fall back to selecting the text so the user can copy manually.
      const el = document.getElementById("recovery-codes-pre");
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  function download(kind: "txt" | "csv") {
    const content = kind === "csv" ? `recovery_code\n${text}` : text;
    const blob = new Blob([`${content}\n`], {
      type: kind === "csv" ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fanzia-recovery-codes.${kind}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <pre id="recovery-codes-pre" className="card" style={{ background: "#fafafa" }}>
        {text}
      </pre>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
        <button type="button" className="btn btn-secondary" onClick={copy}>
          {copied ? "Copied!" : "Copy"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => download("txt")}>
          Download .txt
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => download("csv")}>
          Download .csv
        </button>
      </div>
    </div>
  );
}
