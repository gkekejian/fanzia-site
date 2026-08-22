import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Anton } from "next/font/google";
import CookieBanner from "@/components/CookieBanner";
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

const SITE_URL = "https://www.fanzia.io";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Fanzia — Trading Card Retail & Wholesale | Glendale, CA",
    template: "%s | Fanzia",
  },
  description:
    "Southern California trading card retailer and wholesale supplier. Pokémon, Magic, and sports cards in packs, boxes, and bundles. Storefront in Glendale.",
  keywords: [
    "trading card store Glendale",
    "Pokemon cards Los Angeles",
    "Magic the Gathering wholesale",
    "trading card wholesale supplier",
    "sports card retailer Southern California",
  ],
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Fanzia",
    title: "Fanzia — Trading Card Retail & Wholesale | Glendale, CA",
    description:
      "Southern California trading card retailer and wholesale supplier. Pokémon, Magic, and sports cards in packs, boxes, and bundles. Storefront in Glendale.",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Fanzia — Trading Card Retail & Wholesale | Glendale, CA",
    description:
      "Southern California trading card retailer and wholesale supplier. Pokémon, Magic, and sports cards in packs, boxes, and bundles. Storefront in Glendale.",
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
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Fanzia",
    url: SITE_URL,
    logo: `${SITE_URL}/brand/logo-black.png`,
    email: "contact@fanzia.io",
    telephone: "+1-818-796-3388",
    foundingDate: "2021",
    sameAs: [
      "https://www.instagram.com/fanzia",
      // {{TODO: social URLs}} — confirm live TikTok handle before publishing
      "https://www.tiktok.com/@fanzia",
    ],
  };

  const localBusinessJsonLd = {
    "@context": "https://schema.org",
    "@type": "Store",
    name: "Fanzia Glendale",
    url: SITE_URL,
    email: "contact@fanzia.io",
    telephone: "+1-818-796-3388",
    // {{TODO: og image}} — replace with real storefront photography once shot
    image: `${SITE_URL}/brand/logo-black.png`,
    priceRange: "$$",
    address: {
      "@type": "PostalAddress",
      streetAddress: "320 North Verdugo Road",
      addressLocality: "Glendale",
      addressRegion: "CA",
      postalCode: "91206",
      addressCountry: "US",
    },
    // {{TODO: confirm hours}} — default posted hours below
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
        opens: "11:00",
        closes: "18:00",
      },
    ],
  };

  return (
    <html lang="en" className={`${jakarta.variable} ${anton.variable}`}>
      <body className="bg-black font-sans text-brand-cream antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organizationJsonLd),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(localBusinessJsonLd),
          }}
        />
        {children}
        <CookieBanner />
      </body>
    </html>
  );
}
