import Link from "next/link";
import MotionSection from "../MotionSection";

export default function WholesaleTeaser() {
  return (
    <MotionSection className="border-y border-white/10 bg-black py-16 text-white md:py-20">
      <div className="container">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-center lg:gap-16">
          <div className="lg:col-span-8">
            <h2 className="display text-3xl text-white md:text-4xl">
              Wholesale &amp; <span className="hl">Sourcing</span>
            </h2>
            <p className="mt-4 max-w-2xl text-white/70">
              TCG sourcing is fragmented. US, Japanese, and Chinese product
              typically means three separate distributor relationships,
              three payment terms, and three lead times. Fanzia consolidates
              them into one account for independent retailers and operators.
            </p>
          </div>
          <div className="lg:col-span-4 lg:text-right">
            <Link href="/wholesale" className="btn-primary">
              Apply for Wholesale
            </Link>
          </div>
        </div>
      </div>
    </MotionSection>
  );
}
