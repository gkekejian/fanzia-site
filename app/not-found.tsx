import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-primary px-6 text-center text-white">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-accent">
          404
        </p>
        <h1 className="mt-3 text-4xl font-bold">Page not found.</h1>
        <p className="mt-3 text-white/70">
          The page you were looking for doesn&rsquo;t exist.
        </p>
        <Link href="/" className="btn-primary mt-8 inline-flex">
          Back to home
        </Link>
      </div>
    </main>
  );
}
