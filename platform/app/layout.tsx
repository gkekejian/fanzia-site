import type { Metadata } from "next";
import "./globals.css";
import { ensureStartupTasks } from "@/lib/startup";

export const metadata: Metadata = {
  title: "Fanzia Wholesale Platform",
  description: "Internal wholesale operations platform. Not for public use.",
  robots: { index: false, follow: false },
};

// Force server-rendering on every request (no static CDN serving). The
// startup tasks below (migrations + owner bootstrap) run inside the layout's
// server render; fully static pages would never re-render at request time,
// so the bootstrap would silently never run in production.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Once per server process: pending migrations, then real-owner provisioning.
  // Awaited (not fire-and-forget) — see ensureStartupTasks.
  await ensureStartupTasks();
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
