export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-white/10 bg-brand-primary py-10 text-white/70">
      <div className="container flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
        <div className="text-sm">
          <span className="font-bold text-white">Fanzia, Inc.</span>
          <span className="mx-2 text-white/30">|</span>
          <span>&copy; {year} All rights reserved.</span>
        </div>

        <nav className="flex flex-wrap items-center gap-6 text-sm">
          <a href="/terms" className="hover:text-white">
            Terms
          </a>
          <a href="/privacy" className="hover:text-white">
            Privacy
          </a>
          <a
            href="https://www.instagram.com/fanzia"
            aria-label="Instagram"
            className="hover:text-white"
            rel="noreferrer"
            target="_blank"
          >
            <InstagramIcon />
          </a>
          <a
            href="https://www.linkedin.com/company/fanzia"
            aria-label="LinkedIn"
            className="hover:text-white"
            rel="noreferrer"
            target="_blank"
          >
            <LinkedInIcon />
          </a>
        </nav>
      </div>
    </footer>
  );
}

function InstagramIcon() {
  return (
    <svg
      width="20"
      height="20"
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
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.22 8h4.56v14H.22V8zm7.4 0h4.37v1.92h.06c.61-1.15 2.1-2.37 4.32-2.37 4.62 0 5.47 3.04 5.47 6.99V22h-4.56v-6.22c0-1.48-.03-3.39-2.06-3.39-2.07 0-2.39 1.62-2.39 3.29V22H7.62V8z" />
    </svg>
  );
}
