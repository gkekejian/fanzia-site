import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fanzia Wholesale Platform",
  description: "Internal wholesale operations platform. Not for public use.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
