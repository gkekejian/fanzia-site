import type { Metadata } from "next";
import Image from "next/image";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import MotionSection from "@/components/MotionSection";
import WavePattern from "@/components/WavePattern";

export const metadata: Metadata = {
  title: "About",
  description:
    "Fanzia started in 2021 in Glendale, California. We're collectors first, operating a storefront, retail locations, and a wholesale arm across Southern California.",
};

const VALUES = [
  {
    title: "Sealed and authentic.",
    copy: "Every unit sourced through authorized channels.",
  },
  {
    title: "Sized for independents.",
    copy: "Quantities and mixes that fit real retail footprints.",
  },
  {
    title: "Operators serving operators.",
    copy: "We run retail ourselves.",
  },
];

export default function AboutPage() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav />
      <main id="main" tabIndex={-1} className="bg-black text-white">
        <MotionSection className="relative pt-32 md:pt-40">
          <div className="container grid gap-12 lg:grid-cols-12 lg:items-stretch lg:gap-16">
            <div className="lg:col-span-7">
              <p className="eyebrow">About Fanzia</p>
              <h1 className="h-section">
                By the Fans.
                <br />
                <span className="hl">For the Fans.</span>
              </h1>
              <p className="mt-8 max-w-2xl text-lg text-white/75 md:text-xl">
                Fanzia started in 2021 in Glendale, California. We&rsquo;re collectors first &mdash;
                the kind of people who track release calendars, know which print runs matter, and
                care whether a bundle arrives sealed and square. That&rsquo;s the standard we buy
                to and the standard we sell to.
              </p>
              <p className="mt-5 max-w-2xl text-lg text-white/75 md:text-xl">
                Today Fanzia operates a Glendale storefront, retail locations across Southern
                California, and a wholesale arm supplying independent retailers and operators with
                US, Japanese, and Chinese trading card product.
              </p>

              <dl className="mt-10 grid gap-0 border-[3px] border-brand-red md:grid-cols-3">
                {VALUES.map((v, i) => (
                  <div
                    key={v.title}
                    className={`bg-brand-ink p-5 ${
                      i < VALUES.length - 1 ? "border-b-[3px] border-brand-red md:border-b-0 md:border-r-[3px]" : ""
                    }`}
                  >
                    <dt className="font-display text-sm uppercase tracking-tight text-white">{v.title}</dt>
                    <dd className="mt-2 text-sm text-white/70">{v.copy}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <aside className="lg:col-span-5">
              <div className="relative h-full min-h-[420px] overflow-hidden bg-brand-red">
                <WavePattern
                  className="pointer-events-none absolute inset-0 h-full w-full"
                  stroke="#000"
                  opacity={0.22}
                  lines={24}
                />
                <div
                  aria-hidden
                  className="absolute inset-0"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(45deg, rgba(0,0,0,0.08) 0 2px, transparent 2px 18px)",
                  }}
                />
                <div className="relative flex h-full flex-col items-center justify-center p-10 text-center">
                  <Image
                    src="/brand/logo-white.png"
                    alt="Fanzia"
                    width={480}
                    height={130}
                    className="w-[220px] drop-shadow-[0_0_30px_rgba(0,0,0,0.35)] md:w-[300px]"
                  />
                  <p className="mt-8 max-w-xs font-display text-sm uppercase leading-relaxed tracking-[0.3em] text-black">
                    By the Fans.
                    <br />
                    For the Fans.
                  </p>
                </div>
                <div className="absolute -left-4 top-6 rotate-[-3deg] bg-black px-5 py-1.5 font-display text-[10px] uppercase tracking-[0.28em] text-brand-red">
                  Est. 2021
                </div>
                <div className="absolute -right-3 bottom-10 rotate-[3deg] bg-black px-5 py-1.5 font-display text-[10px] uppercase tracking-[0.28em] text-white">
                  Glendale, CA
                </div>
              </div>
            </aside>
          </div>
        </MotionSection>
      </main>
      <Footer />
    </>
  );
}
