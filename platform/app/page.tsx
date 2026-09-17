import Link from "next/link";

export default function HomePage() {
  return (
    <main className="container">
      <h1>Fanzia Wholesale Platform</h1>
      <p>
        This is Fanzia&rsquo;s internal wholesale operations platform, not the public marketing
        site. Fanzia is an independent wholesale sourcing and import business and is not
        affiliated with, authorized by, or endorsed by any trading card rights holder.
      </p>
      <p>
        <Link className="btn" href="/apply">
          Apply for a wholesale account
        </Link>{" "}
        <Link className="btn btn-secondary" href="/admin/login">
          Staff login
        </Link>
      </p>
    </main>
  );
}
