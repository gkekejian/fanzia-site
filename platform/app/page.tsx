export default function HomePage() {
  return (
    <main className="container">
      <h1>Fanzia</h1>
      <p>
        This is Fanzia&rsquo;s internal operations platform, not the public marketing site.
        Fanzia is not affiliated with, authorized by, or endorsed by any trading card rights
        holder.
      </p>
      <p>
        <a href="https://www.fanzia.io">Visit fanzia.io</a>
      </p>
      {/* Staff sign-in lives at /admin/login directly — it is intentionally
          not linked from this public page so customers never see it. */}
    </main>
  );
}
