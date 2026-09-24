/** Shown in place of a module's screen when it's switched off in Settings. */
export function ModuleOff({ label }: { label: string }) {
  return (
    <main className="container" style={{ maxWidth: "720px" }}>
      <div className="empty-state card" style={{ marginTop: "2rem" }}>
        <strong>{label} is turned off.</strong>
        It&rsquo;s hidden from the menu and its scheduled jobs don&rsquo;t run.{" "}
        <a href="/admin/settings#Modules">Turn it on in Settings</a> if you need it.
      </div>
    </main>
  );
}
