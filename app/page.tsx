import Nav from "@/components/Nav";
import Hero from "@/components/Hero";
import Services from "@/components/Services";
import HowWeWork from "@/components/HowWeWork";
import Results from "@/components/Results";
import Retail from "@/components/Retail";
import Testimonials from "@/components/Testimonials";
import About from "@/components/About";
import Contact from "@/components/Contact";
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
        <Services />
        <HowWeWork />
        <Results />
        <Retail />
        <Testimonials />
        <About />
        <Contact />
      </main>
      <Footer />
    </>
  );
}
