import Image from "next/image";

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
              AI-Powered Growth for Local Businesses. Glendale &amp; Los
              Angeles, CA.
            </p>
            <p className="mt-6 font-display text-xs uppercase tracking-[0.3em] text-brand-red">
              By the Fanz, for the Fanz.
            </p>
          </div>

          <nav className="md:col-span-4">
            <p className="font-display text-xs uppercase tracking-[0.3em] text-white/40">
              Site
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              <li><a href="#services" className="hover:text-brand-red">Services</a></li>
              <li><a href="#how-we-work" className="hover:text-brand-red">Process</a></li>
              <li><a href="#results" className="hover:text-brand-red">Results</a></li>
              <li><a href="#retail" className="hover:text-brand-red">Retail / VendToyz</a></li>
              <li><a href="#contact" className="hover:text-brand-red">Contact</a></li>
            </ul>
          </nav>

          <div className="md:col-span-3">
            <p className="font-display text-xs uppercase tracking-[0.3em] text-white/40">
              Connect
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              <li>
                <a href="mailto:contact@fanzia.io" className="hover:text-brand-red">
                  contact@fanzia.io
                </a>
              </li>
              <li>
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
                <a
                  href="https://www.linkedin.com/company/fanzia"
                  className="inline-flex items-center gap-2 hover:text-brand-red"
                  rel="noreferrer"
                  target="_blank"
                >
                  <LinkedInIcon /> LinkedIn
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-col items-start justify-between gap-4 border-t border-white/10 pt-6 text-xs text-white/50 md:flex-row md:items-center">
          <span>&copy; {year} Fanzia, Inc. All rights reserved.</span>
          <span className="flex gap-6">
            <a href="/terms" className="hover:text-brand-red">Terms</a>
            <a href="/privacy" className="hover:text-brand-red">Privacy</a>
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

function LinkedInIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.22 8h4.56v14H.22V8zm7.4 0h4.37v1.92h.06c.61-1.15 2.1-2.37 4.32-2.37 4.62 0 5.47 3.04 5.47 6.99V22h-4.56v-6.22c0-1.48-.03-3.39-2.06-3.39-2.07 0-2.39 1.62-2.39 3.29V22H7.62V8z" />
    </svg>
  );
}
