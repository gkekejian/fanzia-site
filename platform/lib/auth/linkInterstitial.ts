import { NextResponse } from "next/server";

/**
 * Mail security scanners (Outlook Safe Links, Mimecast, Gmail link
 * checks, Slack/iMessage unfurlers) GET every link in an email before the
 * human clicks it. When the GET itself consumed the single-use token, the
 * real click landed on "invalid or expired link". The emailed URL now
 * renders this tiny confirm page on GET; only the POST from the button
 * consumes the token. Scanners do not submit forms.
 *
 * No JavaScript (CSP-safe), no external assets, not indexable.
 */
export function magicLinkInterstitial(opts: { action: string; token: string; heading: string; button: string }) {
  const esc = (v: string) =>
    v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${esc(opts.heading)}</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0b;color:#fff;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{width:min(420px,calc(100% - 32px));padding:32px;border:1px solid #2a2a2a;border-radius:12px;background:#141414}
h1{margin:0 0 8px;font-size:22px}p{margin:0 0 24px;color:#bdbdbd}
button{width:100%;min-height:48px;border:0;border-radius:8px;background:#f13737;color:#fff;font-weight:700;font-size:16px;cursor:pointer}
button:focus-visible{outline:3px solid #fff;outline-offset:2px}
</style></head>
<body><main><h1>${esc(opts.heading)}</h1><p>Tap the button to finish signing in. This link works once.</p>
<form method="post" action="${esc(opts.action)}"><input type="hidden" name="token" value="${esc(opts.token)}">
<button type="submit" autofocus>${esc(opts.button)}</button></form></main></body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}

/** Read the token from a form POST (interstitial) or JSON body. */
export async function readPostedToken(req: Request): Promise<string | null> {
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const json = (await req.json()) as { token?: unknown };
      return typeof json.token === "string" ? json.token : null;
    }
    const form = await req.formData();
    const token = form.get("token");
    return typeof token === "string" ? token : null;
  } catch {
    return null;
  }
}
