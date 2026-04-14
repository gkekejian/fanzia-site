import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const SITE_URL = "https://fanzia.io";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Fanzia | AI-Powered Growth for Local Businesses",
    template: "%s | Fanzia",
  },
  description:
    "Fanzia builds custom AI tools, automated lead generation, intelligent websites, and CRM systems for small businesses in Glendale and Los Angeles.",
  keywords: [
    "AI agency Los Angeles",
    "Glendale web design",
    "lead generation automation",
    "CRM for small business",
    "AI consulting Los Angeles",
  ],
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Fanzia",
    title: "Fanzia | AI-Powered Growth for Local Businesses",
    description:
      "Custom AI tools, automated lead generation, intelligent websites, and CRM systems built for small businesses in Los Angeles.",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Fanzia | AI-Powered Growth for Local Businesses",
    description:
      "Custom AI tools, automated lead generation, intelligent websites, and CRM systems built for small businesses in Los Angeles.",
  },
  alternates: {
    canonical: SITE_URL,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const localBusinessJsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: "Fanzia, Inc.",
    url: SITE_URL,
    email: "hello@fanzia.io",
    description:
      "AI and digital growth agency building custom technology for small businesses in Los Angeles.",
    areaServed: [
      { "@type": "City", name: "Glendale" },
      { "@type": "City", name: "Los Angeles" },
    ],
    address: {
      "@type": "PostalAddress",
      addressLocality: "Glendale",
      addressRegion: "CA",
      addressCountry: "US",
    },
    founder: { "@type": "Person", name: "George Kekejian" },
    sameAs: [
      "https://www.instagram.com/fanzia",
      "https://www.linkedin.com/company/fanzia",
    ],
  };

  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(localBusinessJsonLd),
          }}
        />
        {children}
      </body>
    </html>
  );
}
