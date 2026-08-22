import Image from "next/image";
import Link from "next/link";

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-white/10 bg-black py-14 text-white/70">
      <div className="container">
        <div className="grid gap-10 md:grid-cols-12 md:items-start">
          <div className="md:col-span-5">
            <Image
              src="/brand/logo-white.png"
              alt="Fanzia"
              width={160}
              height={42}
              className="h-9 w-auto"
            />
            <p className="mt-4 max-w-sm text-sm text-white/60">
              320 North Verdugo Road, Glendale, CA 91206
            </p>
            <p className="mt-1 max-w-sm text-sm text-white/60">
              <a href="tel:+18187963388" className="hover:text-brand-red">
                (818) 796-3388
              </a>{" "}
              &middot;{" "}
              <a href="mailto:contact@fanzia.io" className="hover:text-brand-red">
                contact@fanzia.io
              </a>
            </p>
            <p className="mt-6 font-display text-xs uppercase tracking-[0.3em] text-brand-red">
              By the Fans. For the Fans.
            </p>
          </div>

          <nav className="md:col-span-4">
            <p className="font-display text-xs uppercase tracking-[0.3em] text-white/40">
              Site
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              <li><Link href="/store" className="hover:text-brand-red">Store</Link></li>
              <li><Link href="/products" className="hover:text-brand-red">Products</Link></li>
              <li><Link href="/wholesale" className="hover:text-brand-red">Wholesale</Link></li>
              <li><Link href="/catalog" className="hover:text-brand-red">Catalog</Link></li>
              <li><Link href="/supply" className="hover:text-brand-red">Supply</Link></li>
              <li><Link href="/about" className="hover:text-brand-red">About</Link></li>
              <li><Link href="/contact" className="hover:text-brand-red">Contact</Link></li>
            </ul>
          </nav>

          <div className="md:col-span-3">
            <p className="font-display text-xs uppercase tracking-[0.3em] text-white/40">
              Connect
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              <li>
                <Link href="/policies" className="hover:text-brand-red">
                  Policies
                </Link>
              </li>
              <li>
                {/* {{TODO: social URLs}} — confirm live Instagram handle before publishing */}
                <a
                  href="https://www.instagram.com/fanzia"
                  className="inline-flex items-center gap-2 hover:text-brand-red"
                  rel="noreferrer"
                  target="_blank"
                >
                  <InstagramIcon /> Instagram
                </a>
              </li>
              <li>
                {/* {{TODO: social URLs}} — confirm live TikTok handle before publishing */}
                <a
                  href="https://www.tiktok.com/@fanzia"
                  className="inline-flex items-center gap-2 hover:text-brand-red"
                  rel="noreferrer"
                  target="_blank"
                >
                  <TikTokIcon /> TikTok
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-col items-start justify-between gap-4 border-t border-white/10 pt-6 text-xs text-white/50 md:flex-row md:items-center">
          <span>&copy; {year} Fanzia. All rights reserved.</span>
          <span className="flex gap-6">
            <Link href="/terms" className="hover:text-brand-red">Terms</Link>
            <Link href="/privacy" className="hover:text-brand-red">Privacy</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}

function InstagramIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.6 5.82c-.9-.79-1.47-1.94-1.47-3.22H12.9v13.44c0 1.44-1.17 2.6-2.6 2.6a2.6 2.6 0 1 1 0-5.2c.24 0 .48.03.7.1V10.3a5.83 5.83 0 0 0-.7-.04A5.83 5.83 0 1 0 16 16.09V9.4a7.4 7.4 0 0 0 4.29 1.36V8.53a4.85 4.85 0 0 1-3.69-2.71z" />
    </svg>
  );
}
