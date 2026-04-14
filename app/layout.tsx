import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Anton } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jakarta",
});

const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-anton",
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
  alternates: { canonical: SITE_URL },
  robots: { index: true, follow: true },
  icons: {
    icon: "/brand/logo-red.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
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
    sameAs: [
      "https://www.instagram.com/fanzia",
      "https://www.linkedin.com/company/fanzia",
    ],
  };

  return (
    <html lang="en" className={`${jakarta.variable} ${anton.variable}`}>
      <body className="bg-black font-sans text-brand-cream antialiased">
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
