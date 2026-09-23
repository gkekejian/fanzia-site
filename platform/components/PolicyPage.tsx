export function PolicyPage({ title, body }: { title: string; body: string }) {
  return (
    <main className="container">
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
