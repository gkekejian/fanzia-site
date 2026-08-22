import Nav from "@/components/Nav";
import Hero from "@/components/Hero";
import TrustBar from "@/components/home/TrustBar";
import WhatWeCarry from "@/components/home/WhatWeCarry";
import Locations from "@/components/home/Locations";
import WholesaleTeaser from "@/components/home/WholesaleTeaser";
import Community from "@/components/home/Community";
import Footer from "@/components/Footer";

export default function HomePage() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav />
      <main id="main" tabIndex={-1}>
        <Hero />
        <TrustBar />
        <WhatWeCarry />
        <Locations />
        <WholesaleTeaser />
        <Community />
      </main>
      <Footer />
    </>
  );
}
