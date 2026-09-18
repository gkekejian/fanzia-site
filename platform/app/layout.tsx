import type { Metadata } from "next";
import "./globals.css";
import { ensureStartupTasks } from "@/lib/startup";

export const metadata: Metadata = {
  title: "Fanzia Wholesale Platform",
  description: "Internal wholesale operations platform. Not for public use.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Once per server process: pending migrations, then real-owner provisioning.
  // No-op during build and on repeat renders; never throws.
  ensureStartupTasks();
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
