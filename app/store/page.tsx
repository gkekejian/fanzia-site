import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import PageHeader from "@/components/PageHeader";
import MotionSection from "@/components/MotionSection";
import { locations } from "@/content/locations";
import { storePhotos } from "@/content/store-photos";

export const metadata: Metadata = {
  title: "Visit Fanzia",
  description:
    "Fanzia's Glendale storefront and Southern California retail locations. Address, hours, and directions.",
};

export default function StorePage() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav />
      <main id="main" tabIndex={-1} className="bg-black text-white">
        <PageHeader
          eyebrow="Store"
          title="Visit Fanzia"
          deck="Our Glendale storefront and Southern California retail locations."
        />

        {/* Glendale Storefront */}
        <MotionSection className="section pt-8">
          <div className="container grid gap-10 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-6">
              <span className="font-display text-[10px] uppercase tracking-[0.24em] text-brand-red">
                Storefront
              </span>
              <h2 className="mt-3 font-display text-4xl uppercase leading-tight text-white md:text-5xl">
                Fanzia Glendale
              </h2>
              <dl className="mt-8 space-y-5 border-t border-white/10 pt-6">
                <div>
                  <dt className="font-display text-[10px] uppercase tracking-[0.22em] text-white/50">
                    Address
                  </dt>
                  <dd className="mt-1 text-lg text-white/85">
                    320 North Verdugo Road
                    <br />
                    Glendale, CA 91206
                  </dd>
                </div>
                <div>
                  <dt className="font-display text-[10px] uppercase tracking-[0.22em] text-white/50">
                    Hours
                  </dt>
                  {/* {{TODO: confirm hours}} */}
                  <dd className="mt-1 text-lg text-white/85">
                    Tue&ndash;Sat, 11:00 AM &ndash; 6:00 PM
                    <br />
                    Appointments welcome
                  </dd>
                </div>
                <div>
                  <dt className="font-display text-[10px] uppercase tracking-[0.22em] text-white/50">
                    Contact
                  </dt>
                  <dd className="mt-1 text-lg text-white/85">
                    <a href="tel:+18187963388" className="hover:text-brand-red">
                      (818) 796-3388
                    </a>
                    <br />
                    <a href="mailto:contact@fanzia.io" className="hover:text-brand-red">
                      contact@fanzia.io
                    </a>
                  </dd>
                </div>
              </dl>
            </div>
            <div className="lg:col-span-6">
              {/* Static map embed of the Glendale storefront. */}
              <iframe
                title="Map to Fanzia Glendale, 320 North Verdugo Road, Glendale, CA 91206"
                src="https://www.google.com/maps?q=320+North+Verdugo+Road,+Glendale,+CA+91206&output=embed"
                className="h-[320px] w-full border border-white/10 md:h-full md:min-h-[380px]"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          </div>
        </MotionSection>

        {/* Photo gallery */}
        <MotionSection className="section border-t border-white/10 bg-brand-ink">
          <div className="container">
            <p className="eyebrow">In the Store</p>
            <h2 className="h-section">Storefront &amp; interior.</h2>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {storePhotos.map((photo) => (
                <figure
                  key={photo.label}
                  className="relative flex aspect-[3/4] flex-col items-center justify-center gap-2 border border-white/15 bg-brand-coal p-4 text-center"
                >
                  <span className="font-display text-[10px] uppercase tracking-[0.2em] text-brand-red">
                    {photo.label}
                  </span>
                  <span className="text-xs text-white/40">{photo.alt}</span>
                </figure>
              ))}
            </div>
          </div>
        </MotionSection>

        {/* Retail Locations */}
        <MotionSection className="section border-t border-white/10">
          <div className="container">
            <p className="eyebrow">Retail Locations</p>
            <h2 className="h-section">Where to find us.</h2>
            <ul className="mt-10 grid gap-6 md:grid-cols-2">
              {locations.map((loc) => (
                <li key={loc.name} className="card-dark">
                  <span className="font-display text-[10px] uppercase tracking-[0.24em] text-brand-red">
                    {loc.kind}
                  </span>
                  <h3 className="mt-3 font-display text-2xl uppercase leading-tight text-white">
                    {loc.name}
                  </h3>
                  <p className="mt-2 text-white/70">{loc.address}</p>
                </li>
              ))}
            </ul>
            <p className="mt-8 text-white/60">
              Expanding across Southern California.{" "}
              {/* {{TODO: additional locations}} */}
              Additional locations to be announced.
            </p>
          </div>
        </MotionSection>
      </main>
      <Footer />
    </>
  );
}
