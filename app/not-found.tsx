import Link from "next/link";

export default function NotFound() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-black px-6 text-center text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 grid-bg opacity-60"
      />
      <div className="relative">
        <span className="font-display text-xs uppercase tracking-[0.3em] text-brand-red">
          Error / 404
        </span>
        <h1 className="mt-4 display text-7xl text-white md:text-9xl">
          Page <span className="text-brand-red">Not Found</span>
        </h1>
        <p className="mt-4 text-white/60">
          The page you were looking for doesn&rsquo;t exist.
        </p>
        <Link href="/" className="btn-primary mt-10 inline-flex">
          Back to Home
        </Link>
      </div>
    </main>
  );
}
