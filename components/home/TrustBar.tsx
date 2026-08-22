const FACTS = [
  "Est. 2021",
  "Glendale, CA storefront",
  "Multi-location retail",
  "CA seller's permit on file",
];

export default function TrustBar() {
  return (
    <div className="border-b border-white/10 bg-brand-coal py-6">
      <div className="container">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
          {FACTS.map((fact) => (
            <div key={fact} className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 shrink-0 bg-brand-red" aria-hidden />
              <dd className="font-display text-xs uppercase tracking-[0.16em] text-white/80">
                {fact}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
