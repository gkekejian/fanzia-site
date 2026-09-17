export function PolicyPage({ title, body }: { title: string; body: string }) {
  return (
    <main className="container">
      <div className="draft-banner">
        DRAFT — PENDING LEGAL REVIEW. This document is not yet in force and may change before
        launch.
      </div>
      <div className="card">
        <pre
          style={{
            whiteSpace: "pre-wrap",
            fontFamily: "inherit",
            fontSize: "0.95rem",
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          {body}
        </pre>
      </div>
    </main>
  );
}
