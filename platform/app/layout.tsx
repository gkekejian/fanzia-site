import type { Metadata } from "next";
import "./globals.css";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "Fanzia Wholesale Platform",
  description: "Internal wholesale operations platform. Not for public use.",
  robots: { index: false, follow: false },
};

// Every page reads session cookies or live DB state. Migrations no longer
// run here: they run at build time (db/deploy.ts).
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
